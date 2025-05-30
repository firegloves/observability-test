# Scenarios Modules

This directory contains **shared modules** used by multiple k6 test scenarios. These are **NOT standalone test files** but reusable components.

## 📦 Available Modules

### `database-heavy-operations.js`
**Purpose**: Shared module for database-intensive testing operations

**Exports**:
- `executeDatabaseHeavyScenario(session, customMetrics)` - Main execution function
- `getDatabaseHeavyThresholds()` - k6 thresholds configuration  
- `databaseHeavyMetrics` - Dedicated metrics objects

**Used by**:
- `../baseline-performance.js` - As part of mixed traffic (15% database heavy)
- `../database-heavy-only.js` - As 100% focused database testing

**Operations supported**:
- `stats` - Database statistics aggregation
- `complex_join` - Multi-table JOIN queries  
- `aggregation` - Heavy aggregation operations
- `slow_query` - PostgreSQL sleep simulation

## 🚫 Important Notes

**These files are NOT executable test scenarios.** They are modules imported by actual test files.

To run tests, use the files in the parent `scenarios/` directory:

```bash
# ✅ Correct - executable test scenarios
k6 run scenarios/baseline-performance.js
k6 run scenarios/database-heavy-only.js

# ❌ Wrong - these are modules, not tests  
k6 run scenarios/modules/database-heavy-operations.js  # Will fail
```

## 🔧 Adding New Modules

When creating new shared modules:

1. **Place them here**: `scenarios/modules/`
2. **Use descriptive names**: `feature-name-operations.js`
3. **Export functions**: Make functions reusable
4. **Document exports**: Clear JSDoc comments
5. **Update this README**: Document new modules

## 📚 Module Architecture

```
modules/
├── database-heavy-operations.js    # Database testing operations
└── (future modules)                # Add new shared functionality here
```

This keeps the `scenarios/` directory clean with only **executable test files** while providing **reusable components** for complex functionality. 