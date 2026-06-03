"""
Import Lambda — triggered by S3 PUT of a CSV file.
Parses the CSV, enriches each game via RAWG, writes to DynamoDB,
then invokes the Train Lambda to refit the model.
"""

import csv
import io
import json
import os
import time
import urllib.parse

import boto3

from shared import logger
from shared.rawg import search_game, get_game_detail, extract_metadata

GAMES_TABLE = os.environ["GAMES_TABLE"]
TRAIN_FUNCTION = os.environ["TRAIN_FUNCTION"]
RAWG_API_KEY_PARAM = os.environ["RAWG_API_KEY_PARAM"]

s3 = boto3.client("s3")
dynamodb = boto3.resource("dynamodb")
ssm = boto3.client("ssm")
lambda_client = boto3.client("lambda")

table = dynamodb.Table(GAMES_TABLE)


def get_rawg_key() -> str:
    resp = ssm.get_parameter(Name=RAWG_API_KEY_PARAM, WithDecryption=True)
    return resp["Parameter"]["Value"]


def parse_csv(content: str) -> list[dict]:
    reader = csv.DictReader(io.StringIO(content))
    games = []
    for row in reader:
        score = row.get("my_score", "").strip()
        if not score:
            continue  # skip unscored rows
        try:
            my_score = int(score)
        except ValueError:
            continue

        weight = int(row.get("weight", "").strip() or "3")
        weight = max(1, min(5, weight))

        replayed_raw = row.get("replayed", "").strip()
        replayed = int(replayed_raw) if replayed_raw in ("0", "1") else None

        release_year_raw = row.get("release_year", "").strip()
        csv_release_year = int(release_year_raw) if release_year_raw.isdigit() else None

        games.append(
            {
                "title": row["title"].strip(),
                "my_score": my_score,
                "weight": weight,
                "replayed": replayed,
                "csv_release_year": csv_release_year,
                "notes": row.get("notes", "").strip(),
            }
        )
    return games


def enrich_and_store(game: dict, api_key: str) -> None:
    title = game["title"]
    result = search_game(title, api_key)
    if not result:
        logger.warning("RAWG search returned no results", title=title)
        # Store with user data only, no enrichment
        table.put_item(
            Item={
                "game_id": title.lower().replace(" ", "-"),
                "title": title,
                "my_score": game["my_score"],
                "weight": game["weight"],
                "replayed": game.get("replayed"),
                "notes": game["notes"],
                "enriched": False,
            }
        )
        return

    time.sleep(0.25)  # gentle rate limiting
    detail = get_game_detail(result["id"], api_key)
    meta = extract_metadata(detail)

    item = {
        "game_id": meta["rawg_slug"] or title.lower().replace(" ", "-"),
        "title": title,
        "my_score": game["my_score"],
        "weight": game["weight"],
        "notes": game["notes"],
        "enriched": True,
        **{k: v for k, v in meta.items() if v is not None},
    }
    if game.get("replayed") is not None:
        item["replayed"] = game["replayed"]
    # CSV release_year overrides RAWG if provided
    if game.get("csv_release_year"):
        item["release_year"] = game["csv_release_year"]

    table.put_item(Item=item)
    logger.info(
        "Stored game", title=title, rawg_slug=meta["rawg_slug"], score=game["my_score"]
    )


def handler(event: dict, context) -> dict:
    api_key = get_rawg_key()
    bucket = event["Records"][0]["s3"]["bucket"]["name"]
    key = urllib.parse.unquote_plus(event["Records"][0]["s3"]["object"]["key"])

    obj = s3.get_object(Bucket=bucket, Key=key)
    content = obj["Body"].read().decode("utf-8-sig")  # handle BOM from Excel

    games = parse_csv(content)
    logger.info("Parsed CSV", game_count=len(games))

    stored = 0
    failed = 0
    for game in games:
        try:
            enrich_and_store(game, api_key)
            stored += 1
        except Exception as e:
            failed += 1
            logger.error("Failed to enrich game", title=game["title"], error=str(e))

    logger.info("Import complete", stored=stored, failed=failed)

    # Invoke Train Lambda asynchronously
    lambda_client.invoke(
        FunctionName=TRAIN_FUNCTION,
        InvocationType="Event",
        Payload=json.dumps({"source": "import", "game_count": stored}),
    )

    return {"stored": stored, "failed": failed}
