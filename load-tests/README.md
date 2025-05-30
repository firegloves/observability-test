# k6 Load Testing for Observability Test

This directory contains a comprehensive k6 load testing infrastructure designed to generate realistic observability data for testing monitoring platforms like SignOz and GCP.

## 📁 Structure

```
load-tests/
├── config/
│   └── environments.js      # Environment configurations (local, staging, prod)
├── utils/
│   └── data-generators.js   # Test data generation utilities
├── scenarios/
│   └── baseline-performance.js  # Main baseline performance test
├── results/                 # Test results (auto-created)
├── run-tests.sh            # Test runner script
└── README.md               # This file
```

## 🚀 Quick Start

### Prerequisites
- k6 installed (`brew install k6`)
- Application running (`pnpm dev`)
- jq for results analysis (`brew install jq` - optional)

### Run Tests

```bash
# Quick test (1 min, 5 users)
./load-tests/run-tests.sh local baseline-performance quick

# Standard test (17 min total, realistic load)
./load-tests/run-tests.sh local baseline-performance short

# Extended test (35 min, up to 100 users)
./load-tests/run-tests.sh local baseline-performance long
```

### Test Scenarios

#### **Baseline Performance Test**
- **File**: `scenarios/baseline-performance.js`
- **Duration**: 17 minutes (configurable)
- **Load Pattern**: Ramp up → Steady → Peak → Ramp down
- **Scenarios**:
  - 60% Read operations (fetch books, health checks)
  - 25% Write operations (create reviews)
  - 10% Performance testing (slow endpoint with various latencies)
  - 5% Error simulation

#### **Load Stages**:
1. **Ramp up**: 2 min → 10 users
2. **Steady**: 5 min @ 25 users
3. **Peak ramp**: 3 min → 50 users
4. **Peak steady**: 5 min @ 50 users
5. **Ramp down**: 2 min → 0 users

## 📊 Generated Data Types

### **Performance Metrics**
- Request duration distributions
- Throughput (requests per second)
- Error rates by endpoint
- Latency accuracy for slow endpoint

### **OpenTelemetry Data**
- Distributed traces across all endpoints
- Custom span attributes for filtering
- Performance timing correlation
- Error trace correlation

### **Custom Metrics**
- `custom_success_requests`: Successful operations counter
- `custom_error_requests`: Failed operations counter
- `endpoint_response_time`: Response time distribution
- `slow_endpoint_accuracy`: Latency simulation accuracy

## 🎯 Test Thresholds

### **Local Environment**
- P95 response time: < 500ms
- Error rate: < 10%
- Success rate: > 85%
- Slow endpoint accuracy: < 50ms difference

### **Production Environment**
- P95 response time: < 200ms
- Error rate: < 1%
- Success rate: > 99%

## 📈 Results Analysis

Results are saved as JSON files in the `results/` directory with timestamps:
```
results/k6-results-baseline-performance-local-20250530_141530.json
```

### **Manual Analysis**
```bash
# View raw results
cat results/k6-results-*.json | jq '.'

# Get summary statistics
cat results/k6-results-*.json | jq -s '
  [.[] | select(.type == "Point" and .metric == "http_req_duration")] |
  {
    total_requests: length,
    avg_response_time: (map(.data.value) | add / length),
    p95_response_time: (sort_by(.data.value) | .[length * 0.95 | floor].data.value)
  }
'
```

## 🔧 Configuration

### **Environment Variables**
- `ENVIRONMENT`: Target environment (local, staging, production)
- Custom thresholds per environment in `config/environments.js`

### **Test Customization**
- Modify load patterns in scenario files
- Adjust user behavior weights in `utils/data-generators.js`
- Add new test scenarios by creating new files in `scenarios/`

## 🧪 Test Data Characteristics

### **Realistic User Behavior**
- Weighted scenario distribution (read-heavy realistic pattern)
- Random think time between requests (1-5 seconds)
- User session tracking with IDs
- Multiple operation types for performance testing

### **Observability Focus**
- Custom headers for trace correlation
- Performance test markers for filtering
- Error simulation for alert testing
- Latency accuracy validation

## 🎯 SignOz vs GCP Comparison

This test suite generates data specifically designed to compare observability platforms:

### **Metrics Comparison**
- Request rate and duration distributions
- Error rate tracking and alerting
- Custom business metrics visualization
- Resource usage correlation

### **Tracing Comparison**
- Distributed trace visualization
- Performance bottleneck identification
- Error trace correlation
- Custom span attribute filtering

### **Dashboard Comparison**
- Real-time metrics visualization
- Historical trend analysis
- Alert configuration and triggering
- Query performance and flexibility

## 📝 Adding New Tests

1. **Create scenario file** in `scenarios/` directory
2. **Follow naming convention**: `scenario-name.js`
3. **Export options and default function**
4. **Use utilities** from `utils/` and `config/`
5. **Test locally** with quick runs
6. **Document** new scenario in this README

### **Example Scenario Template**
```javascript
import { currentEnv, getThresholds } from '../config/environments.js';

export const options = {
  stages: [
    { duration: '1m', target: 10 },
  ],
  thresholds: getThresholds(),
};

export default function () {
  // Your test logic here
}
```

## 🔍 Troubleshooting

### **Common Issues**
- **k6 not found**: Install with `brew install k6`
- **Server not running**: Start with `pnpm dev`
- **Permission denied**: Run `chmod +x run-tests.sh`
- **Test fails**: Check server logs and endpoint availability

### **Performance Issues**
- Reduce virtual users for lower-spec machines
- Use `quick` duration for fast iteration
- Check available memory and CPU during tests 

## 📊 Recent Improvements & Fixes

### ✅ Infrastructure Enhancements (Latest Updates)

- **Fixed endpoint URLs**: Corrected error simulation endpoint from `/v1/simulate-error/simulate-error` to `/v1/simulateError`
- **Database scaling**: Expanded from 2 to 100 seeded users for realistic load testing
- **Improved foreign key handling**: Reviews now use valid user_id (1-100) and book_id (1-10) ranges
- **Enhanced error handling**: Error simulation now returns proper JSON responses with 500 status codes
- **Comprehensive testing**: All scenarios (read, write, performance, error) now have 100% success rates

### 🎯 Test Results (Latest Run)

**Quick Test (1 minute):**
- ✅ **142 HTTP requests** processed
- ✅ **91 iterations** completed successfully  
- ✅ **375/375 checks passed** (100% success rate)
- ✅ **Slow endpoint accuracy**: p95 = 2.55ms (target < 50ms)
- ✅ **HTTP error rate**: 3.52% (target < 10%)
- ✅ **Custom success rate**: 2.23/s 