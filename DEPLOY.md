# mySunshine Backend — Deployment Guide

## Architecture

- **Compute:** AWS App Runner (containerized Node.js)
- **Auth DB:** Amazon RDS PostgreSQL (users, subscriptions)
- **Diary DB:** MongoDB Atlas (entries, children — flexible for AI later)
- **Media:** S3 bucket (photos, videos)
- **Region:** us-west-2 (closest to Bay Area)

---

## Step 1: Create the PostgreSQL Database (RDS)

1. Go to **AWS Console → RDS → Create database**
2. Choose:
   - Engine: PostgreSQL 16
   - Template: Free tier
   - DB instance identifier: `mysunshine-db`
   - Master username: `mysunshine_admin`
   - Master password: (save this — you'll need it)
   - Instance: `db.t3.micro` (free tier)
   - Storage: 20 GB gp3
   - Public access: Yes (for initial setup; lock down later)
   - VPC security group: create new, allow port 5432
3. Once created, copy the **Endpoint** (e.g. `mysunshine-db.xxxxx.us-west-2.rds.amazonaws.com`)
4. Connect and create the database:
   ```
   psql -h <endpoint> -U mysunshine_admin -d postgres
   CREATE DATABASE mysunshine;
   ```
   (The app auto-creates the tables on first start.)

---

## Step 2: Set Up MongoDB Atlas

1. Go to https://cloud.mongodb.com → Create a free cluster
2. Choose: AWS, us-west-2, M0 (free tier)
3. Create a database user (username + password)
4. Network access: Add `0.0.0.0/0` for now (lock down to App Runner IPs later)
5. Get the connection string:
   ```
   mongodb+srv://user:pass@cluster.mongodb.net/mysunshine?retryWrites=true&w=majority
   ```

---

## Step 3: Create the S3 Bucket

```bash
aws s3 mb s3://mysunshine-media --region us-west-2

# Block public access (media served via presigned URLs)
aws s3api put-public-access-block \
  --bucket mysunshine-media \
  --public-access-block-configuration \
  BlockPublicAcls=true,IgnorePublicAcls=true,BlockPublicPolicy=true,RestrictPublicBuckets=true

# Enable CORS for web app later
aws s3api put-bucket-cors --bucket mysunshine-media --cors-configuration '{
  "CORSRules": [{
    "AllowedOrigins": ["*"],
    "AllowedMethods": ["GET", "PUT", "POST"],
    "AllowedHeaders": ["*"],
    "MaxAgeSeconds": 3600
  }]
}'
```

---

## Step 4: Push to GitHub

```bash
cd mysunshine-backend
git init
git add .
git commit -m "Initial mySunshine backend"
git remote add origin https://github.com/YOUR_USERNAME/mysunshine-backend.git
git push -u origin main
```

---

## Step 5: Deploy to App Runner

### Option A: From source code (simplest)

1. Go to **AWS Console → App Runner → Create service**
2. Source: **Source code repository**
3. Connect to GitHub → select `mysunshine-backend` repo
4. Branch: `main`
5. Build settings: Use `apprunner.yaml` in the repo
6. Service settings:
   - Port: 8080
   - CPU: 0.25 vCPU, Memory: 0.5 GB (cheapest)
   - Auto-deploy: Yes (deploys on every git push)
7. Environment variables (add these):
   ```
   PG_HOST=mysunshine-db.xxxxx.us-west-2.rds.amazonaws.com
   PG_PORT=5432
   PG_DATABASE=mysunshine
   PG_USER=mysunshine_admin
   PG_PASSWORD=<your password>
   MONGO_URI=mongodb+srv://user:pass@cluster.mongodb.net/mysunshine
   JWT_SECRET=<generate a random 64-char string>
   AWS_REGION=us-west-2
   S3_BUCKET=mysunshine-media
   NODE_ENV=production
   ```
8. Click **Create & deploy**

### Option B: From Docker image (more control)

```bash
# Build and push to ECR
aws ecr create-repository --repository-name mysunshine-backend
aws ecr get-login-password | docker login --username AWS --password-stdin <account>.dkr.ecr.us-west-2.amazonaws.com

docker build -t mysunshine-backend .
docker tag mysunshine-backend:latest <account>.dkr.ecr.us-west-2.amazonaws.com/mysunshine-backend:latest
docker push <account>.dkr.ecr.us-west-2.amazonaws.com/mysunshine-backend:latest
```

Then in App Runner, choose "Container registry → Amazon ECR" and select the image.

---

## Step 6: Connect iOS App

Once App Runner gives you a URL (e.g. `https://xxxxxx.us-west-2.awsapprunner.com`):

1. Open `mySunshine/Views/AuthService.swift` (you'll create this next)
2. Set `apiBaseURL` to your App Runner URL

---

## Step 7: IAM Role for S3 Access

App Runner needs permission to read/write S3. Create an instance role:

```bash
# Create the role
aws iam create-role \
  --role-name mysunshine-apprunner-role \
  --assume-role-policy-document '{
    "Version": "2012-10-17",
    "Statement": [{
      "Effect": "Allow",
      "Principal": {"Service": "tasks.apprunner.amazonaws.com"},
      "Action": "sts:AssumeRole"
    }]
  }'

# Attach S3 policy
aws iam put-role-policy \
  --role-name mysunshine-apprunner-role \
  --policy-name s3-media-access \
  --policy-document '{
    "Version": "2012-10-17",
    "Statement": [{
      "Effect": "Allow",
      "Action": ["s3:GetObject", "s3:PutObject", "s3:DeleteObject"],
      "Resource": "arn:aws:s3:::mysunshine-media/*"
    }]
  }'
```

Then in App Runner service settings, set the **Instance role** to `mysunshine-apprunner-role`.

---

## Cost Estimate (Monthly)

| Service            | Tier         | Cost       |
|--------------------|-------------|------------|
| App Runner         | 0.25 vCPU   | ~$5-15     |
| RDS PostgreSQL     | db.t3.micro | Free (12mo)|
| MongoDB Atlas      | M0           | Free       |
| S3 (photos)        | per GB      | ~$0.023/GB |
| S3 (videos)        | per GB      | ~$0.023/GB |
| Data transfer      | per GB      | ~$0.09/GB  |
| **Total (light use)** |          | **~$5-20** |

---

## Future: App Performance Monitoring

1. **AWS X-Ray** — add `aws-xray-sdk` to trace every API request
2. **CloudWatch** — App Runner sends logs automatically
3. **CloudWatch RUM** — for the web app (Real User Monitoring)
4. **Custom metrics** — track entries created, photos uploaded, active users

---

## Future: AI Integration

The MongoDB schema is ready for AI:

1. Uncomment `embedding` and `aiTags` fields in `src/models/Entry.js`
2. Use AWS Bedrock (Claude API) to:
   - Auto-tag entries by theme ("first steps", "funny moment", "milestone")
   - Generate age-appropriate summaries for the child
   - Semantic search across all entries
3. Create a MongoDB Atlas Vector Search index on the `embedding` field
4. Store embeddings from Bedrock's embedding model (Titan Embeddings)
