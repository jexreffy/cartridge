"""Helpers for loading and saving the sklearn model artifact from/to S3."""

import io
import os
import pickle
import json
from typing import Any

import boto3

BUCKET = os.environ.get("MODEL_BUCKET", "")
MODEL_KEY = "model/latest.pkl"
META_KEY = "model/metadata.json"


def save_model(model: Any, metadata: dict) -> None:
    s3 = boto3.client("s3")
    buf = io.BytesIO()
    pickle.dump(model, buf)
    buf.seek(0)
    s3.put_object(Bucket=BUCKET, Key=MODEL_KEY, Body=buf.read())
    s3.put_object(
        Bucket=BUCKET,
        Key=META_KEY,
        Body=json.dumps(metadata).encode(),
        ContentType="application/json",
    )


def load_model() -> tuple[Any, dict]:
    s3 = boto3.client("s3")
    obj = s3.get_object(Bucket=BUCKET, Key=MODEL_KEY)
    model = pickle.loads(obj["Body"].read())
    meta_obj = s3.get_object(Bucket=BUCKET, Key=META_KEY)
    metadata = json.loads(meta_obj["Body"].read())
    return model, metadata


def load_metadata() -> dict:
    s3 = boto3.client("s3")
    obj = s3.get_object(Bucket=BUCKET, Key=META_KEY)
    return json.loads(obj["Body"].read())
