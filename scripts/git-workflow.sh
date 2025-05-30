#!/bin/bash

# Git workflow automation script for observability-test project
# Usage: ./scripts/git-workflow.sh STEP_NUMBER "Step Description" "commit message details"
# Example: ./scripts/git-workflow.sh 002 "database-heavy-endpoint" "implement database heavy endpoint for load testing"

set -e

# Check if correct number of arguments provided
if [ $# -ne 3 ]; then
    echo "Usage: $0 STEP_NUMBER BRANCH_SUFFIX 'COMMIT_MESSAGE_DETAILS'"
    echo "Example: $0 002 'database-heavy-endpoint' 'implement database heavy endpoint for load testing'"
    exit 1
fi

STEP_NUMBER=$1
BRANCH_SUFFIX=$2
COMMIT_DETAILS=$3
BRANCH_NAME="fc/observability-${STEP_NUMBER}-${BRANCH_SUFFIX}"
TICKET_ID="fc/observability-${STEP_NUMBER}"

echo "🚀 Starting Git workflow for Step ${STEP_NUMBER}"
echo "Branch: ${BRANCH_NAME}"
echo "Ticket: ${TICKET_ID}"

# Ensure we're on main and it's clean
echo "📍 Switching to main branch..."
git checkout main

echo "🔍 Checking for unstaged changes..."
if [ -n "$(git status --porcelain)" ]; then
    echo "📁 Staging all changes..."
    git add .
else
    echo "✅ No changes to stage"
fi

# Create and switch to feature branch
echo "🌿 Creating feature branch: ${BRANCH_NAME}"
git checkout -b "${BRANCH_NAME}"

# Commit changes if any
if [ -n "$(git diff --cached --name-only)" ]; then
    echo "💾 Committing changes..."
    git commit -m "feat: ${COMMIT_DETAILS}

${TICKET_ID}"
else
    echo "ℹ️  No staged changes to commit"
fi

# Push the branch
echo "⬆️  Pushing branch to remote..."
git push -u origin "${BRANCH_NAME}"

# Switch back to main and update
echo "🔄 Switching back to main..."
git checkout main

echo "📥 Pulling latest changes from main..."
git pull origin main

echo "🔀 Merging feature branch..."
git merge "${BRANCH_NAME}"

echo "⬆️  Pushing updated main..."
git push origin main

# Clean up local branch
echo "🧹 Cleaning up local feature branch..."
git branch -d "${BRANCH_NAME}"

echo "✅ Git workflow completed successfully!"
echo "🔗 Remote branch still exists: origin/${BRANCH_NAME}"
echo "🔗 You can create a PR or delete the remote branch if needed"

echo ""
echo "Next step commands:"
echo "  - Continue development"
echo "  - Or delete remote branch: git push origin --delete ${BRANCH_NAME}" 