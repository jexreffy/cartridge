"""Helpers for loading and saving the sklearn model artifact from/to S3."""

import io
import json
import os
import pickle
from typing import Any

import boto3

BUCKET = os.environ.get("MODEL_BUCKET", "")


def _keys(user_id: str) -> tuple[str, str]:
    return f"models/{user_id}/latest.pkl", f"models/{user_id}/metadata.json"


def save_model(model: Any, metadata: dict, user_id: str) -> None:
    model_key, meta_key = _keys(user_id)
    s3 = boto3.client("s3")
    buf = io.BytesIO()
    pickle.dump(model, buf)
    buf.seek(0)
    s3.put_object(Bucket=BUCKET, Key=model_key, Body=buf.read())
    s3.put_object(
        Bucket=BUCKET,
        Key=meta_key,
        Body=json.dumps(metadata).encode(),
        ContentType="application/json",
    )


def load_model(user_id: str) -> tuple[Any, dict]:
    model_key, meta_key = _keys(user_id)
    s3 = boto3.client("s3")
    obj = s3.get_object(Bucket=BUCKET, Key=model_key)
    model = pickle.loads(obj["Body"].read())
    meta_obj = s3.get_object(Bucket=BUCKET, Key=meta_key)
    metadata = json.loads(meta_obj["Body"].read())
    return model, metadata


def load_metadata(user_id: str) -> dict:
    _, meta_key = _keys(user_id)
    s3 = boto3.client("s3")
    obj = s3.get_object(Bucket=BUCKET, Key=meta_key)
    return json.loads(obj["Body"].read())
