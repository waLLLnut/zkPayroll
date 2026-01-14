#!/bin/bash
# Benchmark RLWE circuit with memory and time measurements
#
# Tests both Halo2 and Plonky2 backends
# Requires: /usr/bin/time, nargo, backends installed

set -e

RESULTS_FILE="benchmark_results.txt"
RESULTS_CSV="benchmark_results.csv"

echo "===== RLWE Optimized Circuit Benchmark ====="
echo ""
echo "Date: $(date)"
echo "System: $(uname -a)"
echo ""

# Clear previous results
> "$RESULTS_FILE"
> "$RESULTS_CSV"

# CSV header
echo "Stage,Backend,Time(s),Memory(MB),Status" >> "$RESULTS_CSV"

# Function to run and measure
measure() {
    local stage="$1"
    local backend="$2"
    local cmd="$3"

    echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
    echo "📊 $stage ($backend)"
    echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"

    # Use /usr/bin/time for detailed measurements
    if command -v /usr/bin/time &> /dev/null; then
        /usr/bin/time -v $cmd 2>&1 | tee temp_output.txt

        # Extract metrics
        TIME=$(grep "Elapsed (wall clock)" temp_output.txt | awk '{print $NF}' || echo "N/A")
        MEM_KB=$(grep "Maximum resident set size" temp_output.txt | awk '{print $NF}' || echo "0")
        MEM_MB=$(echo "scale=2; $MEM_KB / 1024" | bc)

        STATUS="✅"
        if [ $? -ne 0 ]; then
            STATUS="❌"
        fi

        echo ""
        echo "Results:"
        echo "  Time: $TIME"
        echo "  Peak Memory: ${MEM_MB} MB (${MEM_KB} KB)"
        echo "  Status: $STATUS"
        echo ""

        # Save to files
        echo "$stage ($backend):" >> "$RESULTS_FILE"
        echo "  Time: $TIME" >> "$RESULTS_FILE"
        echo "  Memory: ${MEM_MB} MB" >> "$RESULTS_FILE"
        echo "  Status: $STATUS" >> "$RESULTS_FILE"
        echo "" >> "$RESULTS_FILE"

        # Save to CSV
        TIME_SECONDS=$(echo "$TIME" | awk -F: '{if (NF==3) print ($1*3600)+($2*60)+$3; else if (NF==2) print ($1*60)+$2; else print $1}')
        echo "$stage,$backend,$TIME_SECONDS,$MEM_MB,$STATUS" >> "$RESULTS_CSV"

        rm -f temp_output.txt
    else
        echo "⚠️  /usr/bin/time not found, using basic timing"
        time $cmd
        echo "$stage,$backend,N/A,N/A,unknown" >> "$RESULTS_CSV"
    fi
}

# Generate test data
echo "🔧 Generating test data..."
python3 generate_test_data.py

# Stage 1: Compilation
measure "Compilation" "Noir" "nargo compile"

# Stage 2: Constraint info
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "📈 Circuit Information"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
nargo info | tee -a "$RESULTS_FILE"
echo ""

# Stage 3: Witness generation
measure "Witness Generation" "Noir" "nargo execute"

# Stage 4: Tests
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "🧪 Running Tests"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
measure "Tests" "Noir" "nargo test"

# Stage 5: Proving (Plonky2)
if command -v acvm-backend-plonky2 &> /dev/null; then
    echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
    echo "⚡ Plonky2 Proving (Fast Mode)"
    echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
    measure "Proving" "Plonky2" "nargo prove --backend plonky2"

    if [ -f "proofs/rlwe_optimized.proof" ]; then
        PROOF_SIZE=$(wc -c < "proofs/rlwe_optimized.proof")
        PROOF_SIZE_KB=$(echo "scale=2; $PROOF_SIZE / 1024" | bc)
        echo "Proof size: ${PROOF_SIZE_KB} KB" | tee -a "$RESULTS_FILE"
    fi
else
    echo "⚠️  Plonky2 backend not found, skipping proving"
    echo "   Install: cargo install --git https://github.com/eryxcoop/acvm-backend-plonky2"
fi

# Stage 6: Proving (Halo2) - if available
if command -v acvm-backend-halo2 &> /dev/null; then
    echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
    echo "🐢 Halo2 Proving (Low Memory Mode)"
    echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
    measure "Proving" "Halo2" "nargo prove --backend halo2"

    if [ -f "proofs/rlwe_optimized.proof" ]; then
        PROOF_SIZE=$(wc -c < "proofs/rlwe_optimized.proof")
        PROOF_SIZE_KB=$(echo "scale=2; $PROOF_SIZE / 1024" | bc)
        echo "Proof size: ${PROOF_SIZE_KB} KB" | tee -a "$RESULTS_FILE"
    fi
else
    echo "⚠️  Halo2 backend not found, skipping"
    echo "   (Halo2 backend integration pending)"
fi

# Summary
echo ""
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "📊 Benchmark Complete!"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo ""
echo "Results saved to:"
echo "  - $RESULTS_FILE (human-readable)"
echo "  - $RESULTS_CSV (machine-readable)"
echo ""
echo "Summary:"
cat "$RESULTS_FILE"
echo ""
echo "CSV Data:"
cat "$RESULTS_CSV"
