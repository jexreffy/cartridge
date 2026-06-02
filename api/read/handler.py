"""
Read Lambda — serves the /library and /profile API routes.
"""
import json
import os
from decimal import Decimal

import boto3
from boto3.dynamodb.conditions import Attr

from shared import logger

GAMES_TABLE = os.environ["GAMES_TABLE"]
PROFILE_TABLE = os.environ["PROFILE_TABLE"]

dynamodb = boto3.resource("dynamodb")
games_table = dynamodb.Table(GAMES_TABLE)
profile_table = dynamodb.Table(PROFILE_TABLE)


def decimal_default(obj):
    if isinstance(obj, Decimal):
        return float(obj)
    raise TypeError


def get_library() -> dict:
    items = []
    resp = games_table.scan()
    items.extend(resp["Items"])
    while "LastEvaluatedKey" in resp:
        resp = games_table.scan(ExclusiveStartKey=resp["LastEvaluatedKey"])
        items.extend(resp["Items"])
    items.sort(key=lambda x: float(x.get("my_score", 0)), reverse=True)
    return {
        "statusCode": 200,
        "headers": {"Content-Type": "application/json", "Access-Control-Allow-Origin": "*"},
        "body": json.dumps(items, default=decimal_default),
    }


def get_profile() -> dict:
    resp = profile_table.get_item(Key={"profile_id": "main"})
    item = resp.get("Item")
    if not item:
        return {"statusCode": 404, "body": json.dumps({"error": "Profile not generated yet"})}
    return {
        "statusCode": 200,
        "headers": {"Content-Type": "application/json", "Access-Control-Allow-Origin": "*"},
        "body": json.dumps(item, default=decimal_default),
    }


def handler(event: dict, context) -> dict:
    path = event.get("rawPath") or event.get("path", "/")
    logger.info("Read request", path=path)

    if path == "/library":
        return get_library()
    elif path == "/profile":
        return get_profile()
    else:
        return {"statusCode": 404, "body": json.dumps({"error": "Not found"})}
