"""
Games Lambda — handles all write operations for the game library.

Routes:
  POST   /import           — accept CSV body, store in S3 (triggers import Lambda via S3 event)
  POST   /games            — add a single game (enriches via RAWG)
  PUT    /games/{game_id}  — update a game's user-entered fields
  DELETE /games/{game_id}  — remove a game from the library
  POST   /train            — manually trigger model retraining
"""

import json
import os
import time
from decimal import Decimal

import boto3

from shared import logger
from shared.rawg import extract_metadata, get_game_detail, search_game

GAMES_TABLE = os.environ["GAMES_TABLE"]
CSV_BUCKET = os.environ["CSV_BUCKET"]
TRAIN_FUNCTION = os.environ["TRAIN_FUNCTION"]
RAWG_API_KEY_PARAM = os.environ["RAWG_API_KEY_PARAM"]

dynamodb = boto3.resource("dynamodb")
s3 = boto3.client("s3")
ssm = boto3.client("ssm")
lambda_client = boto3.client("lambda")
games_table = dynamodb.Table(GAMES_TABLE)


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


def respond(status: int, body: dict) -> dict:
    return {
        "statusCode": status,
        "headers": {
            "Content-Type": "application/json",
            "Access-Control-Allow-Origin": "*",
        },
        "body": json.dumps(body),
    }


# ---------------------------------------------------------------------------
# POST /import — receive CSV text, store to S3, let S3 event trigger import
# ---------------------------------------------------------------------------
def handle_import(event: dict, user_id: str) -> dict:
    csv_content = event.get("body", "")
    if not csv_content:
        return respond(400, {"error": "Empty request body"})

    # If API Gateway base64-encoded the body (binary mode)
    if event.get("isBase64Encoded"):
        import base64

        csv_content = base64.b64decode(csv_content).decode("utf-8-sig")

    key = f"uploads/{user_id}/my_games.csv"
    s3.put_object(Bucket=CSV_BUCKET, Key=key, Body=csv_content.encode("utf-8"))
    logger.info("CSV uploaded to S3", user_id=user_id, key=key)

    return respond(
        202, {"message": "Import started. Your library will be ready in a few minutes."}
    )


# ---------------------------------------------------------------------------
# POST /games — add a single game, enriched via RAWG
# ---------------------------------------------------------------------------
def handle_add_game(event: dict, user_id: str) -> dict:
    try:
        body = json.loads(event.get("body") or "{}")
    except json.JSONDecodeError:
        return respond(400, {"error": "Invalid JSON body"})

    title = (body.get("title") or "").strip()
    if not title:
        return respond(400, {"error": "title is required"})

    my_score = body.get("my_score")
    if my_score is None:
        return respond(400, {"error": "my_score is required"})

    weight = max(1, min(5, int(body.get("weight") or 3)))
    replayed = int(body.get("replayed") or 0)
    notes = (body.get("notes") or "").strip()
    csv_release_year = body.get("release_year")

    api_key = get_rawg_key()
    result = search_game(title, api_key)

    if result:
        time.sleep(0.25)
        detail = get_game_detail(result["id"], api_key)
        meta = extract_metadata(detail)
        game_id = meta["rawg_slug"] or title.lower().replace(" ", "-")
        item = {
            "user_id": user_id,
            "game_id": game_id,
            "title": title,
            "my_score": int(my_score),
            "weight": weight,
            "replayed": replayed,
            "notes": notes,
            "enriched": True,
            **{k: v for k, v in meta.items() if v is not None},
        }
        if csv_release_year:
            item["release_year"] = int(csv_release_year)
    else:
        logger.warning("RAWG search returned no results for new game", title=title)
        game_id = title.lower().replace(" ", "-")
        item = {
            "user_id": user_id,
            "game_id": game_id,
            "title": title,
            "my_score": int(my_score),
            "weight": weight,
            "replayed": replayed,
            "notes": notes,
            "enriched": False,
        }
        if csv_release_year:
            item["release_year"] = int(csv_release_year)

    games_table.put_item(Item=item)
    logger.info("Added game", user_id=user_id, game_id=game_id, title=title)

    # Serialize Decimals for response
    resp_item = {k: float(v) if isinstance(v, Decimal) else v for k, v in item.items()}
    return respond(201, resp_item)


# ---------------------------------------------------------------------------
# PUT /games/{game_id} — update user-entered fields only
# ---------------------------------------------------------------------------
def handle_update_game(event: dict, user_id: str) -> dict:
    game_id = (event.get("pathParameters") or {}).get("game_id", "")
    if not game_id:
        return respond(400, {"error": "game_id path parameter required"})

    try:
        body = json.loads(event.get("body") or "{}")
    except json.JSONDecodeError:
        return respond(400, {"error": "Invalid JSON body"})

    # Only allow updating user-entered fields, not RAWG metadata
    allowed = {"my_score", "weight", "replayed", "notes"}
    updates = {k: v for k, v in body.items() if k in allowed}
    if not updates:
        return respond(400, {"error": "No updatable fields provided"})

    # Validate ranges
    if "weight" in updates:
        updates["weight"] = max(1, min(5, int(updates["weight"])))
    if "replayed" in updates:
        updates["replayed"] = int(updates["replayed"])
    if "my_score" in updates:
        updates["my_score"] = int(updates["my_score"])

    set_expr = "SET " + ", ".join(f"#{k} = :{k}" for k in updates)
    expr_names = {f"#{k}": k for k in updates}
    expr_values = {f":{k}": v for k, v in updates.items()}

    games_table.update_item(
        Key={"user_id": user_id, "game_id": game_id},
        UpdateExpression=set_expr,
        ExpressionAttributeNames=expr_names,
        ExpressionAttributeValues=expr_values,
    )
    logger.info(
        "Updated game", user_id=user_id, game_id=game_id, fields=list(updates.keys())
    )
    return respond(200, {"game_id": game_id, "updated": list(updates.keys())})


# ---------------------------------------------------------------------------
# DELETE /games/{game_id}
# ---------------------------------------------------------------------------
def handle_delete_game(event: dict, user_id: str) -> dict:
    game_id = (event.get("pathParameters") or {}).get("game_id", "")
    if not game_id:
        return respond(400, {"error": "game_id path parameter required"})

    games_table.delete_item(Key={"user_id": user_id, "game_id": game_id})
    logger.info("Deleted game", user_id=user_id, game_id=game_id)
    return respond(200, {"deleted": game_id})


# ---------------------------------------------------------------------------
# POST /train — manually trigger model retraining
# ---------------------------------------------------------------------------
def handle_train(event: dict, user_id: str) -> dict:
    lambda_client.invoke(
        FunctionName=TRAIN_FUNCTION,
        InvocationType="Event",
        Payload=json.dumps({"source": "manual", "user_id": user_id}),
    )
    logger.info("Manual train triggered", user_id=user_id)
    return respond(
        202, {"message": "Model retraining started. This takes a few minutes."}
    )


# ---------------------------------------------------------------------------
# Router
# ---------------------------------------------------------------------------
def handler(event: dict, context) -> dict:
    method = event.get("requestContext", {}).get("http", {}).get("method", "").upper()
    path = event.get("rawPath") or event.get("path", "")

    try:
        user_id = get_user_id(event)
    except ValueError as e:
        return respond(401, {"error": str(e)})

    if path == "/import" and method == "POST":
        return handle_import(event, user_id)
    elif path == "/games" and method == "POST":
        return handle_add_game(event, user_id)
    elif path.startswith("/games/") and method == "PUT":
        return handle_update_game(event, user_id)
    elif path.startswith("/games/") and method == "DELETE":
        return handle_delete_game(event, user_id)
    elif path == "/train" and method == "POST":
        return handle_train(event, user_id)
    else:
        return respond(404, {"error": "Not found"})
