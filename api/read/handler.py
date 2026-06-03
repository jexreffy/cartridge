"""
Read Lambda — serves the /library and /profile API routes.
Extracts user_id from the Cognito JWT authorizer claims.
"""

import json
import os
from decimal import Decimal

import boto3
from boto3.dynamodb.conditions import Key

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


def get_library(user_id: str) -> dict:
    items = []
    resp = games_table.query(KeyConditionExpression=Key("user_id").eq(user_id))
    items.extend(resp["Items"])
    while "LastEvaluatedKey" in resp:
        resp = games_table.query(
            KeyConditionExpression=Key("user_id").eq(user_id),
            ExclusiveStartKey=resp["LastEvaluatedKey"],
        )
        items.extend(resp["Items"])
    items.sort(key=lambda x: float(x.get("my_score", 0)), reverse=True)
    return {
        "statusCode": 200,
        "headers": {
            "Content-Type": "application/json",
            "Access-Control-Allow-Origin": "*",
        },
        "body": json.dumps(items, default=decimal_default),
    }


def get_profile(user_id: str) -> dict:
    resp = profile_table.get_item(Key={"user_id": user_id})
    item = resp.get("Item")
    if not item:
        return {
            "statusCode": 404,
            "body": json.dumps({"error": "Profile not generated yet"}),
        }
    return {
        "statusCode": 200,
        "headers": {
            "Content-Type": "application/json",
            "Access-Control-Allow-Origin": "*",
        },
        "body": json.dumps(item, default=decimal_default),
    }


def handler(event: dict, context) -> dict:
    path = event.get("rawPath") or event.get("path", "/")
    logger.info("Read request", path=path)

    try:
        user_id = get_user_id(event)
    except ValueError as e:
        return {"statusCode": 401, "body": json.dumps({"error": str(e)})}

    if path == "/library":
        return get_library(user_id)
    elif path == "/profile":
        return get_profile(user_id)
    else:
        return {"statusCode": 404, "body": json.dumps({"error": "Not found"})}
