# Cartridge 🎮

**A personal video game library and ML-powered taste prediction engine.**

Cartridge lets you rate your game history, then uses a trained machine learning model to predict how much you'll enjoy any new game. A weekly automated feed surfaces new Switch releases ranked by your predicted score. Everything runs serverlessly on AWS, deployed via infrastructure-as-code, and secured with Cognito authentication.

---

## Table of Contents

- [Architecture Overview](#architecture-overview)
- [AWS Services](#aws-services)
- [CDK Stack Breakdown](#cdk-stack-breakdown)
- [Machine Learning Pipeline](#machine-learning-pipeline)
- [Authentication](#authentication)
- [API Design](#api-design)
- [Frontend](#frontend)
- [CI/CD Pipeline](#cicd-pipeline)
- [Key Design Decisions](#key-design-decisions)

---

## Architecture Overview

```
Browser (React + Vite)
  │
  │  Cognito IdToken (JWT)
  ▼
API Gateway (HTTP API)
  │  JWT Authorizer — validates every request against Cognito User Pool
  ├── GET  /library          ──► Read Lambda (VPC)      ──► DynamoDB cartridge-games-v2
  ├── GET  /profile          ──► Read Lambda (VPC)      ──► DynamoDB cartridge-profile-v2
  ├── GET  /predict?title=   ──► Predict Lambda         ──► RAWG API → S3 model artifact
  ├── GET  /feed             ──► Feed Lambda            ──► DynamoDB cartridge-predictions-v2
  ├── POST /import           ──► Games Lambda           ──► S3 CSV bucket
  ├── POST /games            ──► Games Lambda           ──► RAWG API → DynamoDB
  ├── PUT  /games/{id}       ──► Games Lambda           ──► DynamoDB (partial update)
  ├── DELETE /games/{id}     ──► Games Lambda           ──► DynamoDB
  └── POST /train            ──► Games Lambda           ──► Train Lambda (async invoke)

S3 CSV bucket
  │  Object created (uploads/{user_id}/my_games.csv)
  ▼
Import Lambda (15 min timeout)
  │  For each game: RAWG search → enrich metadata → DynamoDB write
  ▼
Train Lambda (10 min timeout)
  │  Scan user games → build feature matrix → fit GradientBoostingRegressor
  │  Save model to S3 (models/{user_id}/latest.pkl)
  └► Bedrock Claude (taste profile) ──► DynamoDB cartridge-profile-v2

EventBridge (Sunday 00:00 UTC)
  ▼
Feed Lambda
  │  RAWG new Switch releases (last 14 days)
  └► Predict Lambda × N ──► DynamoDB cartridge-predictions-v2
```

---

## AWS Services

### Amazon Cognito
Manages user identity. The User Pool stores accounts with email/password authentication and handles the full auth lifecycle — signup, email verification, and token refresh. The App Client issues three tokens on login: an **IdToken** (JWT containing user claims like `sub` and `email`), an **AccessToken**, and a **RefreshToken**.

Every Lambda that serves API traffic extracts `event.requestContext.authorizer.jwt.claims.sub` as the `user_id`, which scopes all DynamoDB reads and writes to that user. This means the data model is naturally multi-tenant: one DynamoDB table serves all users, with `user_id` as the partition key.

Self-signup is enabled — users register directly on the website. The email verification step confirms ownership before the account is active.

### API Gateway (HTTP API)
The HTTP API variant was chosen over REST API for lower latency, lower cost, and simpler JWT authorizer integration. The JWT authorizer intercepts every request, validates the `Authorization: Bearer {IdToken}` header against the Cognito User Pool's public JWKS endpoint, and injects the decoded claims into the Lambda event — no code needed in each Lambda to verify signatures.

CORS is configured at the API level to allow the frontend origin, including the `Authorization` header, which is blocked by default.

### AWS Lambda
Six Lambda functions cover the full application surface:

| Function | Runtime | VPC | Timeout | Purpose |
|---|---|---|---|---|
| `cartridge-read` | Python 3.12 | ✅ Yes | 10s | GET /library, GET /profile |
| `cartridge-games` | Python 3.12 | No | 30s | All write operations + import trigger |
| `cartridge-predict` | Python 3.12 | No | 30s | RAWG lookup + ML score prediction |
| `cartridge-feed` | Python 3.12 | No | 5 min | Weekly feed refresh + GET /feed |
| `cartridge-import` | Python 3.12 | No | 15 min | CSV parse + RAWG enrichment + DynamoDB writes |
| `cartridge-train` | Python 3.12 | No | 10 min | Feature engineering + model training + S3 save |

The Read Lambda runs inside the VPC because it only communicates with DynamoDB via a VPC Gateway Endpoint — it never needs the public internet. Lambdas that call the RAWG public API run outside the VPC to avoid the cost and complexity of a NAT Gateway.

**Cold starts** are mitigated by keeping the scikit-learn model cached in the Lambda execution environment after the first load (`_model_cache` dict keyed by `user_id`). Subsequent predictions within the same warm container skip the S3 fetch entirely.

### DynamoDB (PAY_PER_REQUEST)
Three tables, all with `user_id` as partition key:

| Table | PK | SK | Contents |
|---|---|---|---|
| `cartridge-games-v2` | `user_id` | `game_id` (RAWG slug) | Full game record: user scores + RAWG metadata |
| `cartridge-predictions-v2` | `user_id` | `{game_id}#pred#{date}` | Prediction results with 90-day TTL |
| `cartridge-profile-v2` | `user_id` | — | Taste profile text + model feature importances |

PAY_PER_REQUEST billing was chosen over provisioned capacity because usage is bursty (import writes ~200 items in rapid succession, then nothing for hours). There's no minimum charge for idle capacity. TTL on the predictions table automatically expires old entries without any cleanup Lambda.

**Why user_id as partition key?** DynamoDB's access pattern is almost always "get all games for this user." With `user_id` as PK and `game_id` as SK, a single `Query` (not `Scan`) retrieves the full library in one or two pages. This is O(user's library size) instead of O(entire table), which matters at scale.

### S3
Two buckets:

**`cartridge-csv-{account}`** — receives CSV uploads from the website. An S3 event notification on `prefix=uploads/, suffix=.csv` triggers the Import Lambda. The key format `uploads/{user_id}/my_games.csv` encodes the uploader's identity directly in the path, which the Import Lambda parses to scope all downstream writes. Lifecycle rule deletes objects after 30 days.

**`cartridge-model-{account}`** — stores trained model artifacts versioned per user: `models/{user_id}/latest.pkl` (scikit-learn pipeline pickled with joblib) and `models/{user_id}/metadata.json` (feature list, training date, top feature importances). Versioning is enabled so a bad retrain can be rolled back by restoring the previous version.

### VPC + VPC Endpoints
The Read Lambda runs in private isolated subnets with no internet route. It reaches DynamoDB through a **VPC Gateway Endpoint** — traffic stays entirely within the AWS network and is free. This demonstrates the networking pattern of least-privilege egress: a Lambda that only needs DynamoDB should not have an internet route at all.

A security group restricts Lambda egress to the DynamoDB endpoint only.

### SSM Parameter Store
The RAWG API key is stored as a `SecureString` parameter at `/cartridge/rawg-api-key`. Lambdas that call RAWG read it at cold start via `ssm:GetParameter`. The deploy workflow writes the key via `put-parameter --overwrite` so it never appears in source code or CDK definitions. IAM policies grant each Lambda access to exactly that one parameter ARN, not all of SSM.

### EventBridge Scheduler
A weekly cron rule (`cron(0 0 ? * SUN *)`) invokes the Feed Lambda every Sunday at midnight UTC. The Feed Lambda queries RAWG for Switch games released in the past 14 days, runs each through the Predict Lambda, and stores results in DynamoDB for the Weekly Feed tab. Users see fresh predictions every Monday morning without any manual action.

### Amazon Bedrock (Claude Haiku)
Used once at the end of training to generate a natural-language taste profile. The prompt includes the user's top 20 rated games, bottom 5, genre distribution, and top tags. The output is stored in DynamoDB and displayed in the Predict tab. Because the profile is generated once and cached, there's no per-query AI cost — predictions at runtime use only the sklearn model plus the stored profile text.

*Note: Bedrock is blocked on new AWS accounts until a use case review is approved. The architecture supports it fully; the train Lambda handles the `AccessDeniedException` gracefully and skips profile generation until access is granted.*

---

## CDK Stack Breakdown

The infrastructure is split into six stacks deployed in dependency order. Using multiple stacks instead of one monolith means faster partial deploys (only the changed stack redeploys) and clearer separation of concerns.

```
CartridgeNetworking   VPC, subnets, security groups, DynamoDB VPC endpoint
CartridgeAuth         Cognito User Pool + App Client
CartridgeStorage      DynamoDB tables, S3 model bucket
CartridgeImport       S3 CSV bucket, Import Lambda, Train Lambda
CartridgeApi          API Gateway, Read/Games/Predict/Feed Lambdas, JWT authorizer
CartridgeScheduler    EventBridge weekly rule → Feed Lambda
CartridgeCdn          CloudFront + frontend S3 bucket (pending account approval)
```

**Cross-stack references without CloudFormation exports:** Stacks reference shared resources (DynamoDB tables, S3 buckets) by name constants rather than by passing CDK objects between stacks. Passing CDK objects creates CloudFormation `Fn::ImportValue` dependencies that prevent independent stack updates. Using `Table.fromTableName()` and `Bucket.fromBucketName()` breaks this coupling — each stack is independently updatable.

**CDK bundling:** Lambda code is bundled at synth time using the Python 3.12 build image. The bundling command runs `pip install -r requirements.txt -t /asset-output` then copies the source, producing a self-contained deployment package. This keeps the Lambda zip under the 250MB unzipped limit by excluding `boto3` (built into the Lambda runtime) from `requirements.txt`.

---

## Machine Learning Pipeline

### Feature Engineering

Each game in the library becomes one row in the feature matrix:

| Feature group | How it's built | Dimension |
|---|---|---|
| Genre one-hot | `MultiLabelBinarizer` on RAWG genre list | Up to 20 |
| Tag TF-IDF | `TfidfVectorizer(max_features=60)` on RAWG tags | 60 |
| Metacritic score | Normalized 0–1 (default 0.7 if missing) | 1 |
| Release year | Normalized: `(year - 1985) / (2026 - 1985)` | 1 |
| Weighted replay | `replayed × (1 + age_years / 15)` | 1 |

The **weighted replay** feature is the most personal signal in the model. Simply encoding "did I replay it" (0/1) treats replaying *Super Mario RPG* (1996) the same as replaying *Indiana Jones and the Great Circle* (2025). The age weighting corrects this: a game you replayed 30 years after release carries roughly 3× the signal of a new game you replayed. This captures the distinction between games that are good versus games that become defining.

### Model

`GradientBoostingRegressor` from scikit-learn, configured with:
- `n_estimators=200` — 200 sequential trees, each correcting residuals from the previous
- `max_depth=4` — limits individual tree complexity to prevent overfitting on a ~200 game dataset
- `learning_rate=0.05` — small steps per tree, compensated by the higher estimator count
- `subsample=0.8` — each tree trains on 80% of the data (stochastic gradient boosting), adding regularization

**Sample weights** (`weight` field, 1–5) are passed to `.fit()`. A game scored at weight 5 has 5× the influence on the loss function compared to weight 1. This lets historical games (NES era, weight 1–2) inform the model without dominating predictions for modern games.

**Confidence** is computed as the standard deviation of predictions across all 200 individual trees. A tight spread means the trees agree; a wide spread means the game falls outside well-represented territory in the training data.

### Prediction for new games

For unseen games, `weighted_replay = 0.0` since we don't know if the user will replay it. All other features come from RAWG. The predicted score is clipped to [1, 10].

---

## Authentication

The auth flow from the browser:

1. User submits email + password to the login form
2. `amazon-cognito-identity-js` performs SRP (Secure Remote Password) authentication — the password is never sent in plaintext, even over HTTPS
3. Cognito returns an **IdToken** (1-hour JWT), **AccessToken**, and **RefreshToken** (30-day)
4. Tokens are stored in `localStorage` by the SDK automatically
5. Every API call adds `Authorization: Bearer {IdToken}` via the `apiFetch` wrapper
6. API Gateway's JWT authorizer validates the token signature against Cognito's JWKS endpoint and injects `claims.sub` into the Lambda event
7. When the IdToken expires, `getSession()` uses the RefreshToken to obtain a new one transparently

The Cognito `sub` (a UUID assigned at account creation, immutable) is used as `user_id` throughout — not the email address, which can change.

---

## API Design

All endpoints require a valid Cognito JWT. The authorizer rejects requests with a 401 before they reach Lambda.

| Method | Path | Lambda | Description |
|---|---|---|---|
| GET | `/library` | read | All games for the authenticated user |
| GET | `/profile` | read | Stored taste profile + model feature importances |
| GET | `/predict?title=` | predict | RAWG lookup + ML prediction for any game title |
| GET | `/feed` | feed | Weekly predictions for new Switch releases |
| POST | `/import` | games | Upload CSV → writes to S3 → triggers Import Lambda |
| POST | `/games` | games | Add a single game (RAWG-enriched) |
| PUT | `/games/{game_id}` | games | Edit score, weight, replayed, or notes |
| DELETE | `/games/{game_id}` | games | Remove a game from the library |
| POST | `/train` | games | Manually trigger model retraining |

The `game_id` is the RAWG slug (e.g. `the-legend-of-zelda-breath-of-the-wild`), which is stable and human-readable.

---

## Frontend

Built with **React 19 + Vite + TypeScript**. No component library — all UI is hand-written inline styles for full control and zero dependency overhead.

**`auth.ts`** — thin wrapper around `amazon-cognito-identity-js` exposing `signIn`, `signUp`, `confirmSignUp`, `signOut`, `getIdToken`, and `isAuthenticated`.

**`api.ts`** — `apiFetch(path, init)` wraps `fetch` to automatically call `getIdToken()` and inject the `Authorization` header. All components use this instead of raw `fetch`.

**`App.tsx`** — checks `isAuthenticated()` on mount. Shows a loading state, then either the `<Login>` page or the main app. Sign-out clears tokens and returns to the login page.

**`Login.tsx`** — three-state form: sign in, create account, and confirm (verification code). Error messages from Cognito exceptions are mapped to human-readable strings.

**`Library.tsx`** — paginated game grid with search, sort, inline edit/delete per card, CSV import panel, Add Game modal, and a Retrain Model button. Edit and delete operate optimistically on local state.

**`GameModal.tsx`** — shared modal for add and edit. In edit mode it pre-fills with the existing game's values and calls `PUT /games/{game_id}`. In add mode it calls `POST /games` which enriches via RAWG server-side.

**`PredictSearch.tsx`** — search input + recharts horizontal bar chart showing top contributing features, color-coded by whether the feature matched the game. Loads the taste profile once on mount.

**`WeeklyFeed.tsx`** — card grid of the latest feed predictions sorted by predicted score.

---

## CI/CD Pipeline

GitHub Actions with OIDC authentication — no stored AWS access keys anywhere.

```
Push to main
  │
  ├── Set RAWG API key in SSM (put-parameter --overwrite)
  ├── Python lint: black --check + ruff check
  ├── CDK deploy (6 stacks, explicit order)
  ├── Read CartridgeAuth outputs → UserPoolId + ClientId
  └── Frontend build (Vite) with injected env vars:
        VITE_API_URL
        VITE_COGNITO_USER_POOL_ID
        VITE_COGNITO_CLIENT_ID
```

The Cognito IDs are **not stored as static secrets** — they're read from CloudFormation outputs after each deploy. This means if the User Pool is ever recreated, the frontend automatically gets the new IDs on the next push without any manual secret update.

OIDC trust is scoped to the `cartridge-github-deploy` IAM role which has permissions limited to the services this project uses. No `AdministratorAccess`.

---

## Key Design Decisions

**Why not use Amplify?** AWS Amplify would abstract most of this into a config file, but the goal is to demonstrate deep understanding of the underlying services. Every IAM policy, every VPC subnet decision, and every DynamoDB access pattern here is explicit and intentional.

**Why scikit-learn instead of SageMaker?** SageMaker is the right choice for production ML at scale. For a personal library of ~200 games, a `GradientBoostingRegressor` trained in a Lambda function is the right level of complexity — more would be over-engineering. The architecture could be upgraded to SageMaker training jobs and endpoints with minimal changes to the surrounding infrastructure.

**Why PAY_PER_REQUEST DynamoDB?** Usage is extremely bursty. The import process writes ~200 items in 4 minutes then nothing for days. Provisioned capacity would either waste money at idle or throttle during import. PAY_PER_REQUEST handles both patterns naturally.

**Why separate Import and Train Lambdas?** The import process (RAWG API calls, rate limiting) and the training process (scikit-learn, numpy) have very different resource profiles. Separating them allows independent memory allocation (512MB for import, 1024MB for training), independent timeouts, and independent retry behavior. They communicate via async Lambda invoke, not direct calls.

**Why store the model in S3 instead of a container?** The model is ~5MB pickled. Storing it in S3 means it survives Lambda cold starts and can be versioned independently of the code. Any warm Lambda container loads it once and caches it for subsequent requests. If the model is retrained, the next cold start automatically picks up the new version.
