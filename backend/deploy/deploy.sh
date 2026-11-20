#!/usr/bin/env bash
# ─────────────────────────────────────────────
#  Deploy Suraksha API to Cloud Run (asia-south1)
#  Usage:  PROJECT_ID=my-project ./deploy/deploy.sh
#  Run from backend/.  Requires: gcloud, billing enabled.
# ─────────────────────────────────────────────
set -euo pipefail

: "${PROJECT_ID:?Set PROJECT_ID}"
REGION="${REGION:-asia-south1}"
SERVICE="${SERVICE:-suraksha-api}"

gcloud config set project "$PROJECT_ID"

gcloud services enable run.googleapis.com cloudbuild.googleapis.com \
  secretmanager.googleapis.com artifactregistry.googleapis.com aiplatform.googleapis.com

# One-time: create secrets (skip if they exist). Paste value when prompted.
for S in MONGO_URI GEMINI_API_KEY; do
  if ! gcloud secrets describe "$S" >/dev/null 2>&1; then
    echo "Creating secret $S — paste value, then Ctrl-D:"
    gcloud secrets create "$S" --data-file=-
  fi
done

# Let the Cloud Run runtime service account read the secrets and call Vertex AI.
PROJECT_NUM="$(gcloud projects describe "$PROJECT_ID" --format='value(projectNumber)')"
SA="${PROJECT_NUM}-compute@developer.gserviceaccount.com"
for S in MONGO_URI GEMINI_API_KEY; do
  gcloud secrets add-iam-policy-binding "$S" \
    --member="serviceAccount:${SA}" --role="roles/secretmanager.secretAccessor" >/dev/null
done
gcloud projects add-iam-policy-binding "$PROJECT_ID" \
  --member="serviceAccount:${SA}" --role="roles/aiplatform.user" >/dev/null

gcloud run deploy "$SERVICE" \
  --source . \
  --region "$REGION" \
  --allow-unauthenticated \
  --set-secrets "MONGO_URI=MONGO_URI:latest,GEMINI_API_KEY=GEMINI_API_KEY:latest" \
  --set-env-vars "GEMINI_MODEL=gemini-2.5-flash,GEMINI_TRIAGE=on" \
  --min-instances 0 --max-instances 5 --memory 512Mi

echo
echo "Deployed. Next: from the repo root run  firebase deploy --only hosting"
