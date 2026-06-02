"""
Train Lambda — fits a GradientBoostingRegressor on the user's game library.
Saves model artifact + metadata to S3.
Calls Bedrock once to generate/refresh the taste profile.
"""
import json
import os
from datetime import datetime, timezone

import boto3
import numpy as np
from boto3.dynamodb.conditions import Attr
from sklearn.ensemble import GradientBoostingRegressor
from sklearn.feature_extraction.text import TfidfVectorizer
from sklearn.preprocessing import MultiLabelBinarizer

from shared import logger
from shared.model import save_model

GAMES_TABLE = os.environ["GAMES_TABLE"]
PROFILE_TABLE = os.environ["PROFILE_TABLE"]
MODEL_BUCKET = os.environ["MODEL_BUCKET"]
BEDROCK_MODEL = "anthropic.claude-haiku-20240307"

dynamodb = boto3.resource("dynamodb")
bedrock = boto3.client("bedrock-runtime", region_name="us-east-1")

games_table = dynamodb.Table(GAMES_TABLE)
profile_table = dynamodb.Table(PROFILE_TABLE)

TOP_GENRES = 20
TOP_TAGS = 60


def scan_all_games() -> list[dict]:
    items = []
    resp = games_table.scan(FilterExpression=Attr("my_score").exists())
    items.extend(resp["Items"])
    while "LastEvaluatedKey" in resp:
        resp = games_table.scan(
            FilterExpression=Attr("my_score").exists(),
            ExclusiveStartKey=resp["LastEvaluatedKey"],
        )
        items.extend(resp["Items"])
    return items


def build_features(games: list[dict]) -> tuple[np.ndarray, np.ndarray, np.ndarray, dict]:
    """Build feature matrix, target vector, sample weights, and feature metadata."""
    # Fit genre binarizer
    genre_mlb = MultiLabelBinarizer()
    all_genres = [g.get("genres", []) for g in games]
    genre_mlb.fit(all_genres)

    # Fit tag tfidf (tags as space-joined string)
    tag_corpus = [" ".join(g.get("tags", [])) for g in games]
    tag_tfidf = TfidfVectorizer(max_features=TOP_TAGS, sublinear_tf=True)
    tag_tfidf.fit(tag_corpus)

    rows = []
    targets = []
    weights = []

    for g in games:
        genres_vec = genre_mlb.transform([g.get("genres", [])])[0]
        tags_vec = tag_tfidf.transform([" ".join(g.get("tags", []))]).toarray()[0]

        metacritic = float(g.get("metacritic_score") or 70) / 100.0
        release_year = float(g.get("release_year") or 2010)
        release_norm = (release_year - 1985) / (2026 - 1985)

        times = float(g.get("times_completed") or 0)
        times_norm = min(times, 4) / 4.0

        row = np.concatenate([genres_vec, tags_vec, [metacritic, release_norm, times_norm]])
        rows.append(row)
        targets.append(float(g["my_score"]))
        weights.append(float(g.get("weight") or 3))

    X = np.array(rows)
    y = np.array(targets)
    w = np.array(weights)

    meta = {
        "genre_classes": list(genre_mlb.classes_),
        "tag_features": list(tag_tfidf.get_feature_names_out()),
        "feature_count": X.shape[1],
        "genre_mlb": genre_mlb,
        "tag_tfidf": tag_tfidf,
    }
    return X, y, w, meta


def generate_taste_profile(games: list[dict]) -> str:
    """Call Bedrock once to write a natural-language taste profile."""
    top_games = sorted(games, key=lambda g: (g["my_score"], g.get("weight", 3)), reverse=True)[:20]
    low_games = sorted(games, key=lambda g: g["my_score"])[:5]

    from collections import Counter
    genre_counts: Counter = Counter()
    tag_counts: Counter = Counter()
    for g in games:
        genre_counts.update(g.get("genres", []))
        tag_counts.update(g.get("tags", [])[:10])

    top_genres = [g for g, _ in genre_counts.most_common(8)]
    top_tags = [t for t, _ in tag_counts.most_common(12)]

    prompt = f"""You are writing a gamer taste profile for a personal recommendation system.

Based on this player's game library:

TOP RATED GAMES (score/weight):
{chr(10).join(f"- {g['title']} ({g['my_score']}/10, weight {g.get('weight',3)}/5): {g.get('notes','')}" for g in top_games)}

LOWEST RATED:
{chr(10).join(f"- {g['title']} ({g['my_score']}/10): {g.get('notes','')}" for g in low_games)}

TOP GENRES: {', '.join(top_genres)}
TOP TAGS: {', '.join(top_tags)}

Write a 3-paragraph taste profile that captures:
1. What this player loves most (genres, mechanics, styles)
2. What they tend to dislike or rate lower
3. What patterns suggest about games they would enjoy in the future

Be specific and reference actual games from the list. Write in second person ("You tend to...").
Keep it under 250 words."""

    resp = bedrock.invoke_model(
        modelId=BEDROCK_MODEL,
        body=json.dumps({
            "anthropic_version": "bedrock-2023-05-31",
            "max_tokens": 400,
            "messages": [{"role": "user", "content": prompt}],
        }),
        contentType="application/json",
        accept="application/json",
    )
    body = json.loads(resp["body"].read())
    return body["content"][0]["text"]


def handler(event: dict, context) -> dict:
    games = scan_all_games()
    if len(games) < 10:
        logger.error("Not enough games to train", count=len(games))
        return {"error": "insufficient_data", "count": len(games)}

    logger.info("Training model", game_count=len(games))

    X, y, w, feat_meta = build_features(games)

    model_bundle = {
        "regressor": GradientBoostingRegressor(
            n_estimators=200,
            max_depth=4,
            learning_rate=0.05,
            subsample=0.8,
            random_state=42,
        ),
        "genre_mlb": feat_meta["genre_mlb"],
        "tag_tfidf": feat_meta["tag_tfidf"],
    }
    model_bundle["regressor"].fit(X, y, sample_weight=w)

    importances = model_bundle["regressor"].feature_importances_
    genre_classes = feat_meta["genre_classes"]
    tag_features = feat_meta["tag_features"]
    all_feature_names = list(genre_classes) + list(tag_features) + ["metacritic", "release_year", "times_completed"]

    top_features = sorted(
        zip(all_feature_names, importances), key=lambda x: x[1], reverse=True
    )[:15]

    metadata = {
        "trained_at": datetime.now(timezone.utc).isoformat(),
        "game_count": len(games),
        "feature_count": feat_meta["feature_count"],
        "top_features": [{"name": n, "importance": round(float(i), 4)} for n, i in top_features],
        "genre_classes": feat_meta["genre_classes"],
        "tag_features": feat_meta["tag_features"],
        "model_version": datetime.now(timezone.utc).strftime("%Y%m%d%H%M"),
    }

    save_model(model_bundle, metadata)
    logger.info("Model saved", model_version=metadata["model_version"])

    # Generate taste profile via Bedrock (one-time cost)
    try:
        profile_text = generate_taste_profile(games)
        profile_table.put_item(Item={
            "profile_id": "main",
            "text": profile_text,
            "generated_at": datetime.now(timezone.utc).isoformat(),
            "game_count": len(games),
            "top_features": metadata["top_features"],
        })
        logger.info("Taste profile saved")
    except Exception as e:
        logger.error("Bedrock taste profile failed", error=str(e))

    return {"status": "ok", "game_count": len(games), "model_version": metadata["model_version"]}
