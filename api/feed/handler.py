"""
Feed Lambda — triggered weekly by EventBridge or called via GET /feed.

GET /feed (API Gateway, JWT required): returns stored predictions for the authenticated user.
EventBridge trigger: refreshes predictions for ALL users who have a taste profile.
"""

import json
import os
import time
from datetime import datetime, timezone
from decimal import Decimal

import boto3
from boto3.dynamodb.conditions import Key

from shared import logger
from shared.rawg import get_new_releases

PREDICTIONS_TABLE = os.environ["PREDICTIONS_TABLE"]
PROFILE_TABLE = os.environ["PROFILE_TABLE"]
PREDICT_FUNCTION = os.environ["PREDICT_FUNCTION"]
RAWG_API_KEY_PARAM = os.environ["RAWG_API_KEY_PARAM"]

dynamodb = boto3.resource("dynamodb")
ssm = boto3.client("ssm")
lambda_client = boto3.client("lambda")
predictions_table = dynamodb.Table(PREDICTIONS_TABLE)
profile_table = dynamodb.Table(PROFILE_TABLE)


def get_rawg_key() -> str:
    resp = ssm.get_parameter(Name=RAWG_API_KEY_PARAM, WithDecryption=True)
    return resp["Parameter"]["Value"]


def get_user_id(event: dict) -> str:
    claims = (
        event.get("requestContext", {})
        .get("authorizer", {})
        .get("jwt", {})
        .get("claims", {})
    )
    user_id = claims.get("sub")
    if not user_id:
        raise ValueError("Missing user_id in JWT claims")
    return user_id


def get_all_user_ids() -> list[str]:
    """Scan profile table to find all user_ids — used by EventBridge refresh."""
    resp = profile_table.scan(ProjectionExpression="user_id")
    user_ids = [item["user_id"] for item in resp.get("Items", [])]
    while "LastEvaluatedKey" in resp:
        resp = profile_table.scan(
            ProjectionExpression="user_id",
            ExclusiveStartKey=resp["LastEvaluatedKey"],
        )
        user_ids.extend(item["user_id"] for item in resp.get("Items", []))
    return user_ids


def handler(event: dict, context) -> dict:
    # GET /feed from API Gateway — return stored predictions for this user
    if event.get("requestContext"):
        try:
            user_id = get_user_id(event)
        except ValueError as e:
            return {"statusCode": 401, "body": json.dumps({"error": str(e)})}
        return get_feed(user_id)

    # EventBridge trigger — refresh feed for all users with a profile
    return refresh_feed_all()


def get_feed(user_id: str) -> dict:
    resp = predictions_table.query(
        KeyConditionExpression=Key("user_id").eq(user_id),
        FilterExpression="#src = :s",
        ExpressionAttributeNames={"#src": "source"},
        ExpressionAttributeValues={":s": "feed"},
    )
    items = resp.get("Items", [])
    items.sort(key=lambda x: float(x.get("predicted_score", 0)), reverse=True)

    def serialize(item):
        return {
            k: float(v) if isinstance(v, Decimal) else v
            for k, v in item.items()
            if k not in ("ttl", "sk", "user_id")
        }

    return {
        "statusCode": 200,
        "headers": {
            "Content-Type": "application/json",
            "Access-Control-Allow-Origin": "*",
        },
        "body": json.dumps([serialize(i) for i in items[:30]]),
    }


def refresh_feed_for_user(user_id: str, releases: list[dict]) -> int:
    """Run predictions for all new releases for a single user."""
    processed = 0
    for game in releases:
        try:
            resp = lambda_client.invoke(
                FunctionName=PREDICT_FUNCTION,
                InvocationType="RequestResponse",
                Payload=json.dumps({"user_id": user_id, "title": game["name"]}),
            )
            payload = json.loads(resp["Payload"].read())
            body = json.loads(payload.get("body", "{}"))

            ttl = int(time.time()) + (30 * 24 * 60 * 60)
            today = datetime.now(timezone.utc).date().isoformat()
            game_id = body.get("rawg_slug", game["name"])
            predictions_table.put_item(
                Item={
                    "user_id": user_id,
                    "sk": f"{game_id}#feed#{today}",
                    "predicted_score": Decimal(
                        str(round(body.get("predicted_score", 5.0), 1))
                    ),
                    "confidence": Decimal(str(body.get("confidence", 0))),
                    "on_nintendo": body.get("on_nintendo", True),
                    "source": "feed",
                    "title": body.get("title", game["name"]),
                    "genres": body.get("genres", []),
                    "background_image": body.get("background_image", ""),
                    "created_at": datetime.now(timezone.utc).isoformat(),
                    "ttl": ttl,
                }
            )
            processed += 1
            time.sleep(0.5)
        except Exception as e:
            logger.error(
                "Failed to predict for feed game",
                user_id=user_id,
                title=game["name"],
                error=str(e),
            )
    return processed


def refresh_feed_all() -> dict:
    api_key = get_rawg_key()
    releases = get_new_releases(days=14, api_key=api_key, nintendo_only=True)
    logger.info("Fetched new releases", count=len(releases))

    user_ids = get_all_user_ids()
    logger.info("Refreshing feed for users", count=len(user_ids))

    total = 0
    for user_id in user_ids:
        count = refresh_feed_for_user(user_id, releases)
        total += count
        logger.info("Feed refreshed for user", user_id=user_id, processed=count)

    logger.info("Feed refresh complete", total=total)
    return {"processed": total, "users": len(user_ids)}
