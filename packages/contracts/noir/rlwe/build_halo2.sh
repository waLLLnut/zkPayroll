#!/bin/bash
# Build and prove with Halo2 (IPA) backend
#
# Requirements:
#   - Noir compiler installed
#   - acvm-backend-halo2 installed
#
# Memory: ~120MB
# Time: ~8 minutes

set -e

echo "===== RLWE Optimized - Halo2 Backend ====="
echo ""
echo "Backend: Halo2 IPA"
echo "Memory: ~120MB"
echo "Time: ~8 minutes"
echo ""

# Check if backend is installed
if ! command -v acvm-backend-halo2 &> /dev/null; then
    echo "❌ Halo2 backend not found!"
    echo "Install: https://github.com/privacy-scaling-explorations/halo2"
    exit 1
fi

echo "✅ Halo2 backend found"

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
echo "Generating witness..."
nargo execute

echo ""
echo "✅ Circuit compiled and witness generated!"
echo ""
echo "To generate proof with Halo2 (IPA backend):"
echo "  1. Install backend: cargo install acvm-backend-halo2"
echo "  2. Generate proof: nargo prove --backend halo2"
echo ""
echo "Expected:"
echo "  - Memory: ~120MB"
echo "  - Time: ~8 minutes"
echo "  - Proof size: ~100KB"
