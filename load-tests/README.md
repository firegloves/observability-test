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
│   ├── modules/
│   │   ├── README.md                      # Module documentation
│   │   └── database-heavy-operations.js  # Shared database testing module
│   ├── baseline-performance.js           # ✅ EXECUTABLE: Main baseline test
│   └── database-heavy-only.js           # ✅ EXECUTABLE: Focused database test  
├── results/                 # Test results (auto-created)
├── run-tests.sh            # Test runner script
└── README.md               # This file
```

### 🏗️ Architecture Principles

**Clear Separation of Concerns:**
- **`scenarios/`**: Contains only **executable test files**
- **`scenarios/modules/`**: Contains only **reusable components**  
- **`utils/`**: Contains **data generation utilities**
- **`config/`**: Contains **environment-specific settings**

**Module Reusability:**
- Database operations logic is **shared** between baseline and focused tests
- **Consistent metrics** across different test scenarios
- **DRY principle** - no code duplication
- **Easy maintenance** - update logic in one place

**Human-Friendly Organization:**
- Clear distinction between **runnable tests** vs **shared modules**
- **Descriptive file names** (`database-heavy-operations.js` vs `database-heavy.js`)
- **Documentation** in modules directory explaining usage
- **No confusion** about what can be executed directly

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

# NEW: Database Heavy Focused Test (9 min, database operations only)
k6 run --duration 5m --vus 10 load-tests/scenarios/database-heavy-only.js

# Manual database heavy test (custom parameters)
k6 run --stage 1m:5 --stage 3m:15 --stage 2m:25 --stage 2m:10 --stage 1m:0 load-tests/scenarios/database-heavy-only.js
```

### Test Scenarios

#### **Baseline Performance Test**
- **File**: `scenarios/baseline-performance.js`
- **Duration**: 17 minutes (configurable)
- **Load Pattern**: Ramp up → Steady → Peak → Ramp down
- **Scenarios**:
  - 50% Read operations (fetch books, health checks)
  - 20% Write operations (create reviews)
  - 15% **Database heavy operations** (NEW!)
  - 10% Performance testing (slow endpoint with various latencies)
  - 5% Error simulation

#### **Database Heavy Operations Test** (NEW!)
- **Files**: 
  - `scenarios/modules/database-heavy-operations.js` - Shared operations module
  - `scenarios/database-heavy-only.js` - Focused testing scenario
- **Duration**: 9 minutes (focused test) or integrated in baseline
- **Operations**:
  - **30% Stats**: Database statistics aggregation
  - **25% Complex JOIN**: Multi-table JOIN queries with review stats
  - **25% Aggregation**: Rating analysis, author popularity, temporal analysis
  - **20% Slow Query**: PostgreSQL sleep simulation (1-3 seconds)
- **Response Time Expectations**:
  - Stats: < 1 second
  - Complex JOIN: < 2 seconds  
  - Aggregation: < 1.5 seconds
  - Slow Query: < 5 seconds
- **Observability Features**:
  - Operation-specific metrics and tracing
  - Performance impact classification
  - Detailed execution time logging
  - Custom span attributes for filtering

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
- **Database Heavy Metrics** (NEW!):
  - `database_heavy_operations_total`: Total database operations by type
  - `database_heavy_response_time_ms`: Response time by operation type
  - `database_heavy_success_total`: Successful database operations
  - `database_heavy_error_total`: Failed database operations

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

## 📊 Test Scenarios - What They Reveal

### **🎯 Baseline Performance Test - Application Health Baseline**

**What it simulates**: Real user traffic with mixed operations  
**What you can observe**:

- **Application Stability**: Measure baseline performance under realistic load
- **Capacity Planning**: Understand how the system behaves with 10-50 concurrent users
- **Resource Utilization**: CPU, memory, database connections under normal conditions
- **Error Rate Trends**: Identify if specific operations are more error-prone
- **Response Time Distribution**: P50, P95, P99 latencies across different endpoints

**Key Insights for Teams**:
- **SRE Teams**: Set realistic SLOs based on observed baseline metrics
- **Product Teams**: Understand user experience quality under normal traffic
- **Infrastructure Teams**: Capacity planning and scaling decision data
- **Development Teams**: Performance regression detection in CI/CD

**What to watch for**:
- Consistent response times across all operation types
- Error rates staying below 5% (indicating system stability)
- Memory/CPU not exceeding 70% under normal load
- Database connection pool not exhausted

---

### **💾 Database Heavy Operations - Database Performance Analysis**

**What it simulates**: Database-intensive workloads and performance bottlenecks  
**What you can observe**:

- **Database Performance Limits**: How the system behaves under database stress
- **Query Optimization Opportunities**: Identify slow query patterns
- **Connection Pool Management**: Database connection efficiency
- **Caching Effectiveness**: Cache hit/miss rates under heavy DB load
- **Resource Contention**: Database vs application server resource competition

**Key Insights for Teams**:
- **Database Teams**: Query performance optimization targets
- **Backend Teams**: Caching strategy effectiveness validation
- **SRE Teams**: Database scaling and failover scenario planning  
- **Architecture Teams**: Database design bottleneck identification

**What to watch for**:
- Stats operations completing under 1 second (good indexing)
- Complex JOINs under 2 seconds (efficient query design)
- Slow queries behaving predictably (proper timeout handling)
- No database connection leaks during sustained load

---

### **⚡ Performance Testing - Latency Simulation & Monitoring**

**What it simulates**: Variable external dependencies and network conditions  
**What you can observe**:

- **External Service Impact**: How slow dependencies affect overall system
- **Timeout Strategy Effectiveness**: Circuit breaker and retry logic behavior
- **User Experience Degradation**: How latency affects end-user experience
- **System Resilience**: Graceful degradation under poor conditions
- **Monitoring Accuracy**: How well your observability captures real issues

**Key Insights for Teams**:
- **Operations Teams**: Service dependency mapping and monitoring
- **DevOps Teams**: Circuit breaker tuning and configuration
- **Product Teams**: User experience impact assessment
- **QA Teams**: Non-functional requirement validation

**What to watch for**:
- Latency simulation accuracy within 100ms (monitoring precision)
- No cascading failures when dependencies slow down
- Proper timeout implementation (requests don't hang indefinitely)
- Clear correlation between dependency latency and user impact

---

### **💥 Error Simulation - Failure Recovery & Alerting**

**What it simulates**: System failures and error conditions  
**What you can observe**:

- **Error Detection Speed**: How quickly issues are identified
- **Alert Quality**: Signal vs noise in monitoring alerts
- **Recovery Time**: How fast the system returns to normal
- **Error Correlation**: Connecting errors to root causes
- **User Impact Assessment**: Real impact of errors on user experience

**Key Insights for Teams**:
- **SRE Teams**: Alert tuning and incident response validation
- **Development Teams**: Error handling effectiveness
- **Support Teams**: Error correlation and customer impact assessment
- **Business Teams**: Service reliability impact on business metrics

**What to watch for**:
- Alerts firing within 30 seconds of issues
- Clean error traces showing full context
- No error amplification (one error causing many)
- Clear distinction between different error types

---

## 🔍 Cross-Scenario Analysis Opportunities

### **Load Progression Impact**
Compare metrics across different load stages:
- **Response time degradation**: How performance scales with users
- **Error rate increase**: When does the system start failing
- **Resource saturation**: CPU/memory thresholds identification
- **Database behavior**: Connection pooling effectiveness

### **Operation Type Correlation**
Analyze how different operations interact:
- **Resource competition**: Database heavy vs normal operations
- **Error propagation**: How errors in one operation affect others
- **Performance isolation**: Whether slow operations affect fast ones
- **Caching effectiveness**: Hit rates across different operation types

### **Time-Based Patterns**
Identify temporal behavior:
- **Warm-up effects**: System performance improvement over time
- **Resource leaks**: Gradual performance degradation
- **Periodic issues**: Regular performance dips or spikes
- **Seasonal behavior**: Different patterns during different test phases

### **Platform Comparison Insights**
Use data to compare SignOz vs GCP:
- **Query performance**: How fast can you find specific issues
- **Correlation capabilities**: Connecting metrics, logs, and traces
- **Alert flexibility**: Custom alerting rule creation and tuning
- **Cost efficiency**: Resource usage vs feature set analysis

---

## 💡 Actionable Insights Framework

### **Green Scenarios (All Passing)**
- System is performing within expected parameters
- Current architecture scales appropriately
- Monitoring coverage is adequate
- Ready for production traffic increase

### **Yellow Scenarios (Some Thresholds Crossed)**  
- Performance degradation under specific conditions
- Monitoring gaps requiring attention
- Optimization opportunities identified
- Scaling preparation needed

### **Red Scenarios (Multiple Failures)**
- Critical performance issues requiring immediate attention
- Architecture limitations discovered
- Monitoring blind spots exposed
- Production readiness concerns

This framework helps teams move from **"What happened?"** to **"What should we do about it?"**

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