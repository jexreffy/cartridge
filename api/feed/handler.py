"""
Feed Lambda — triggered weekly by EventBridge.
Fetches new Switch releases from RAWG, runs each through the predict Lambda,
stores results in DynamoDB for the dashboard feed.
"""
import json
import os
import time
from datetime import datetime, timezone
from decimal import Decimal

import boto3

from shared import logger
from shared.rawg import get_api_key, get_game_detail, extract_metadata, get_new_releases

PREDICTIONS_TABLE = os.environ["PREDICTIONS_TABLE"]
PREDICT_FUNCTION = os.environ["PREDICT_FUNCTION"]
RAWG_API_KEY_PARAM = os.environ["RAWG_API_KEY_PARAM"]

dynamodb = boto3.resource("dynamodb")
ssm = boto3.client("ssm")
lambda_client = boto3.client("lambda")
predictions_table = dynamodb.Table(PREDICTIONS_TABLE)


def get_rawg_key() -> str:
    resp = ssm.get_parameter(Name=RAWG_API_KEY_PARAM, WithDecryption=True)
    return resp["Parameter"]["Value"]


def handler(event: dict, context) -> dict:
    # Support GET /feed from API Gateway (return stored predictions)
    if event.get("requestContext"):
        return get_feed()

    # Otherwise: EventBridge trigger — refresh the feed
    return refresh_feed()


def get_feed() -> dict:
    resp = predictions_table.scan(
        FilterExpression="source = :s",
        ExpressionAttributeValues={":s": "feed"},
    )
    items = resp.get("Items", [])
    # Sort by predicted score descending
    items.sort(key=lambda x: float(x.get("predicted_score", 0)), reverse=True)

    def serialize(item):
        return {k: float(v) if isinstance(v, Decimal) else v for k, v in item.items()
                if k not in ("ttl", "sk")}

    return {
        "statusCode": 200,
        "headers": {"Content-Type": "application/json", "Access-Control-Allow-Origin": "*"},
        "body": json.dumps([serialize(i) for i in items[:30]]),
    }


def refresh_feed() -> dict:
    api_key = get_rawg_key()
    releases = get_new_releases(days=14, api_key=api_key, nintendo_only=True)
    logger.info("Fetched new releases", count=len(releases))

    processed = 0
    for game in releases:
        try:
            resp = lambda_client.invoke(
                FunctionName=PREDICT_FUNCTION,
                InvocationType="RequestResponse",
                Payload=json.dumps({"title": game["name"]}),
            )
            payload = json.loads(resp["Payload"].read())
            body = json.loads(payload.get("body", "{}"))

            ttl = int(time.time()) + (30 * 24 * 60 * 60)
            today = datetime.now(timezone.utc).date().isoformat()
            predictions_table.put_item(Item={
                "game_id": body.get("rawg_slug", game["name"]),
                "sk": f"pred#{today}",
                "predicted_score": Decimal(str(round(body.get("predicted_score", 5.0), 1))),
                "confidence": Decimal(str(body.get("confidence", 0))),
                "on_nintendo": body.get("on_nintendo", True),
                "source": "feed",
                "title": body.get("title", game["name"]),
                "genres": body.get("genres", []),
                "background_image": body.get("background_image", ""),
                "created_at": datetime.now(timezone.utc).isoformat(),
                "ttl": ttl,
            })
            processed += 1
            time.sleep(0.5)
        except Exception as e:
            logger.error("Failed to predict for feed game", title=game["name"], error=str(e))

    logger.info("Feed refresh complete", processed=processed)
    return {"processed": processed}
