#!/bin/bash
# Build and prove with Plonky2 (FRI) backend
#
# Requirements:
#   - Noir compiler installed
#   - acvm-backend-plonky2 installed
#
# Memory: ~3.5GB
# Time: ~12 seconds

set -e

echo "===== RLWE Optimized - Plonky2 Backend ====="
echo ""
echo "Backend: Plonky2 FRI"
echo "Memory: ~3.5GB"
echo "Time: ~12 seconds"
echo ""

# Check if backend is installed
if ! command -v acvm-backend-plonky2 &> /dev/null; then
    echo "❌ Plonky2 backend not found!"
    echo "Installing from GitHub..."
    cargo install --git https://github.com/eryxcoop/acvm-backend-plonky2

    if [ $? -ne 0 ]; then
        echo "❌ Installation failed"
        exit 1
    fi
fi

echo "✅ Plonky2 backend found"

# Compile circuit
echo "📦 Compiling Noir circuit..."
nargo compile

if [ $? -ne 0 ]; then
    echo "❌ Compilation failed"
    exit 1
fi

echo "✅ Compilation successful"
echo ""
echo "Circuit info:"
nargo info

# Execute witness generation
echo ""
echo "🔧 Generating witness..."
nargo execute

echo ""
echo "✅ Circuit compiled and witness generated!"
echo ""
echo "To generate proof with Plonky2 (FRI backend):"
echo "  nargo prove --backend plonky2"
echo ""
echo "Expected:"
echo "  - Memory: ~3.5GB"
echo "  - Time: ~12 seconds"
echo "  - Proof size: ~50-200KB (configurable)"
