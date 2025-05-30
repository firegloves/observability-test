#!/bin/bash

# k6 load testing runner script for observability testing

set -e

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# Default configuration
ENVIRONMENT=${1:-local}
TEST_SCENARIO=${2:-baseline-performance}
DURATION=${3:-short}

echo -e "${GREEN}🚀 k6 Load Testing - Observability Test${NC}"
echo -e "${YELLOW}📊 Configuration:${NC}"
echo "  Environment: $ENVIRONMENT"
echo "  Test Scenario: $TEST_SCENARIO"
echo "  Duration: $DURATION"
echo ""

# Check if k6 is installed
if ! command -v k6 &> /dev/null; then
    echo -e "${RED}❌ k6 is not installed. Install with: brew install k6${NC}"
    exit 1
fi

# Check if server is running (for local environment)
if [ "$ENVIRONMENT" = "local" ]; then
    echo -e "${YELLOW}🔍 Checking if local server is running...${NC}"
    if ! curl -s http://localhost:8081/health > /dev/null; then
        echo -e "${RED}❌ Local server is not running at http://localhost:8081${NC}"
        echo -e "${YELLOW}💡 Start the server with: pnpm dev${NC}"
        exit 1
    fi
    echo -e "${GREEN}✅ Local server is running${NC}"
fi

# Set test duration based on parameter
case $DURATION in
    "quick")
        TEST_DURATION="--duration 1m --vus 5"
        echo -e "${BLUE}⚡ Running quick test (1 min, 5 users)${NC}"
        ;;
    "short")
        TEST_DURATION=""  # Use default from test file
        echo -e "${BLUE}⚡ Running standard test (17 min total)${NC}"
        ;;
    "long")
        TEST_DURATION="--stage 5m:25,15m:100,10m:100,5m:0"
        echo -e "${BLUE}⚡ Running extended test (35 min, up to 100 users)${NC}"
        ;;
    *)
        echo -e "${RED}❌ Invalid duration. Use: quick, short, or long${NC}"
        exit 1
        ;;
esac

# Build test file path
TEST_FILE="scenarios/${TEST_SCENARIO}.js"

if [ ! -f "$TEST_FILE" ]; then
    echo -e "${RED}❌ Test file not found: $TEST_FILE${NC}"
    echo "Available test scenarios:"
    ls -1 scenarios/*.js | sed 's/scenarios\///g' | sed 's/\.js//g' | sed 's/^/  - /'
    exit 1
fi

# Create results directory if it doesn't exist
mkdir -p results

# Generate timestamp for results
TIMESTAMP=$(date +"%Y%m%d_%H%M%S")
RESULTS_FILE="results/k6-results-${TEST_SCENARIO}-${ENVIRONMENT}-${TIMESTAMP}.json"

echo -e "${YELLOW}📊 Starting k6 test...${NC}"
echo "  Test file: $TEST_FILE"
echo "  Results will be saved to: $RESULTS_FILE"
echo ""

# Run k6 test
k6 run \
    --env ENVIRONMENT="$ENVIRONMENT" \
    --out json="$RESULTS_FILE" \
    $TEST_DURATION \
    "$TEST_FILE"

# Check if test was successful
if [ $? -eq 0 ]; then
    echo ""
    echo -e "${GREEN}✅ k6 test completed successfully!${NC}"
    echo -e "${YELLOW}📊 Results saved to: $RESULTS_FILE${NC}"
    echo ""
    echo -e "${BLUE}📈 Quick Analysis:${NC}"
    
    # Extract some basic stats from the JSON output (if jq is available)
    if command -v jq &> /dev/null; then
        echo "  - Total requests: $(cat "$RESULTS_FILE" | jq -s '[.[] | select(.type == "Point" and .metric == "http_reqs")] | length')"
        echo "  - Average response time: $(cat "$RESULTS_FILE" | jq -s '[.[] | select(.type == "Point" and .metric == "http_req_duration")] | map(.data.value) | add / length | round')"ms
        echo "  - Error rate: $(cat "$RESULTS_FILE" | jq -s '[.[] | select(.type == "Point" and .metric == "http_req_failed")] | map(.data.value) | add / length * 100 | round')%"
    else
        echo "  Install jq for detailed analysis: brew install jq"
    fi
    
    echo ""
    echo -e "${GREEN}✨ Check your observability platforms for the generated data!${NC}"
    echo -e "${YELLOW}🔍 SignOz: http://localhost:3301${NC}"
    echo -e "${YELLOW}🔍 GCP Console: https://console.cloud.google.com/monitoring${NC}"
    
else
    echo -e "${RED}❌ k6 test failed!${NC}"
    exit 1
fi 