"""
Predict Lambda — given a game title (or RAWG slug), predicts a score.
Uses the stored sklearn model + taste profile. Zero Bedrock calls at runtime.

Supports two invocation modes:
  1. API Gateway (JWT required) — user_id from JWT claims
  2. Direct Lambda invoke from Feed (no JWT) — user_id from payload {"user_id": "...", "title": "..."}
"""

import json
import os
import time
from datetime import datetime, timezone
from decimal import Decimal

import boto3
import numpy as np

from shared.rawg import (
    extract_metadata,
    get_game_detail,
    search_game,
)
from shared.model import load_model

PREDICTIONS_TABLE = os.environ["PREDICTIONS_TABLE"]
PROFILE_TABLE = os.environ["PROFILE_TABLE"]
RAWG_API_KEY_PARAM = os.environ["RAWG_API_KEY_PARAM"]

dynamodb = boto3.resource("dynamodb")
ssm = boto3.client("ssm")
predictions_table = dynamodb.Table(PREDICTIONS_TABLE)
profile_table = dynamodb.Table(PROFILE_TABLE)

_model_cache: dict = {}  # keyed by user_id


def get_rawg_key() -> str:
    resp = ssm.get_parameter(Name=RAWG_API_KEY_PARAM, WithDecryption=True)
    return resp["Parameter"]["Value"]


def get_user_id(event: dict) -> str:
    # From JWT authorizer (API Gateway invocation)
    claims = (
        event.get("requestContext", {})
        .get("authorizer", {})
        .get("jwt", {})
        .get("claims", {})
    )
    if claims.get("sub"):
        return claims["sub"]
    # From direct Lambda invoke (Feed Lambda)
    if event.get("user_id"):
        return event["user_id"]
    raise ValueError("No user_id found in event")


def get_model(user_id: str):
    if user_id not in _model_cache:
        _model_cache[user_id] = load_model(user_id)
    return _model_cache[user_id]


def build_feature_vector(
    meta: dict, model_bundle: dict, model_meta: dict
) -> np.ndarray:
    genre_mlb = model_bundle["genre_mlb"]
    tag_tfidf = model_bundle["tag_tfidf"]

    genres_vec = genre_mlb.transform([meta.get("genres", [])])[0]
    tags_vec = tag_tfidf.transform([" ".join(meta.get("tags", []))]).toarray()[0]

    metacritic = float(meta.get("metacritic_score") or 70) / 100.0
    release_year = float(meta.get("release_year") or 2015)
    release_norm = (release_year - 1985) / (2026 - 1985)
    weighted_replay = 0.0  # unknown for new games

    return np.concatenate(
        [genres_vec, tags_vec, [metacritic, release_norm, weighted_replay]]
    )


def compute_factor_breakdown(
    meta: dict, model_bundle: dict, model_meta: dict
) -> list[dict]:
    """Return top contributing features for the explanation."""
    top_features = model_meta.get("top_features", [])[:8]
    genres = set(meta.get("genres", []))
    tags = set(t.lower() for t in meta.get("tags", []))

    factors = []
    for feat in top_features:
        name = feat["name"]
        importance = feat["importance"]
        if name in genres:
            factors.append(
                {
                    "feature": name,
                    "type": "genre",
                    "importance": importance,
                    "matched": True,
                }
            )
        elif name.lower() in tags:
            factors.append(
                {
                    "feature": name,
                    "type": "tag",
                    "importance": importance,
                    "matched": True,
                }
            )
        elif name in ("metacritic", "release_year", "weighted_replay"):
            factors.append(
                {
                    "feature": name,
                    "type": "numeric",
                    "importance": importance,
                    "matched": False,
                }
            )

    return factors[:5]


def handler(event: dict, context) -> dict:
    try:
        user_id = get_user_id(event)
    except ValueError as e:
        return {"statusCode": 401, "body": json.dumps({"error": str(e)})}

    # Support direct Lambda invoke (from feed) and API Gateway
    if "queryStringParameters" in event:
        params = event.get("queryStringParameters") or {}
        title = params.get("title", "").strip()
    else:
        body = event if isinstance(event, dict) else json.loads(event.get("body", "{}"))
        title = body.get("title", "").strip()

    if not title:
        return {"statusCode": 400, "body": json.dumps({"error": "title is required"})}

    api_key = get_rawg_key()
    model_bundle, model_meta = get_model(user_id)

    # Fetch game metadata from RAWG
    result = search_game(title, api_key)
    if not result:
        return {
            "statusCode": 404,
            "body": json.dumps({"error": f"Game not found: {title}"}),
        }

    time.sleep(0.25)
    detail = get_game_detail(result["id"], api_key)
    meta = extract_metadata(detail)

    on_nintendo = meta["is_on_nintendo"]

    # Predict
    X = build_feature_vector(meta, model_bundle, model_meta).reshape(1, -1)
    regressor = model_bundle["regressor"]
    predicted_score = float(np.clip(regressor.predict(X)[0], 1, 10))

    # Confidence: spread of individual tree predictions
    tree_preds = np.array([t.predict(X)[0] for t in regressor.estimators_.flatten()])
    confidence = float(round(np.std(tree_preds), 2))

    factors = compute_factor_breakdown(meta, model_bundle, model_meta)

    # Load taste profile for context
    profile_resp = profile_table.get_item(Key={"user_id": user_id})
    taste_profile = (profile_resp.get("Item") or {}).get("text", "")

    prediction = {
        "title": meta["rawg_name"],
        "searched_title": title,
        "rawg_slug": meta["rawg_slug"],
        "predicted_score": round(predicted_score, 1),
        "confidence": confidence,
        "on_nintendo": on_nintendo,
        "genres": meta["genres"],
        "tags": meta["tags"][:10],
        "developers": meta["developers"],
        "release_year": meta["release_year"],
        "metacritic_score": meta["metacritic_score"],
        "background_image": meta["background_image"],
        "taste_profile": taste_profile,
        "top_factors": factors,
        "model_version": model_meta.get("model_version", ""),
    }

    # Persist prediction (PK=user_id, SK=game_id#pred#date)
    ttl = int(time.time()) + (90 * 24 * 60 * 60)
    today = datetime.now(timezone.utc).date().isoformat()
    predictions_table.put_item(
        Item={
            "user_id": user_id,
            "sk": f"{meta['rawg_slug']}#pred#{today}",
            "predicted_score": Decimal(str(round(predicted_score, 1))),
            "confidence": Decimal(str(confidence)),
            "on_nintendo": on_nintendo,
            "source": "search",
            "title": meta["rawg_name"],
            "genres": meta["genres"],
            "background_image": meta["background_image"],
            "created_at": datetime.now(timezone.utc).isoformat(),
            "ttl": ttl,
        }
    )

    return {
        "statusCode": 200,
        "headers": {
            "Content-Type": "application/json",
            "Access-Control-Allow-Origin": "*",
        },
        "body": json.dumps(prediction),
    }
