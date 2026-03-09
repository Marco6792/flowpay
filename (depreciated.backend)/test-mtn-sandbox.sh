#!/bin/bash

# Test MTN Sandbox with different test MSISDNs
# This script tests various scenarios using MTN's test numbers

API_KEY="pk_live_EPcElqtBUvPJdhQlUCbvBSNNyoqRNJUGhqbzrEdH5Ehs"
BASE_URL="http://localhost:5000/api/v1"

echo "==================================="
echo "Testing MTN Sandbox Test Numbers"
echo "==================================="
echo ""

# Function to create a payment
test_payment() {
    local from=$1
    local expected_status=$2
    local test_name=$3
    
    echo "Testing: $test_name"
    echo "From: $from"
    echo "Expected: $expected_status"
    
    TIMESTAMP=$(date +%s%3N)
    TX_ID="test_${expected_status}_${TIMESTAMP}"
    
    RESPONSE=$(curl -s -X POST "${BASE_URL}/payments" \
        -H "Authorization: Bearer ${API_KEY}" \
        -H "Content-Type: application/json" \
        -d "{
            \"id\": \"${TX_ID}\",
            \"from\": \"${from}\",
            \"to\": \"237680000000@cameroon\",
            \"amount\": 1000,
            \"timestamp\": ${TIMESTAMP}
        }")
    
    echo "Response: $RESPONSE"
    echo "-----------------------------------"
    echo ""
    
    # Wait a bit before next test
    sleep 2
}

# Test successful payment (should map to 56733123453)
test_payment "237670000000@cameroon" "SUCCESS" "Default Success Number"

# Test with numbers ending in specific digits
test_payment "237670000003@cameroon" "SUCCESS" "Number ending in 3 (Success)"
test_payment "237670000000@cameroon" "FAILED" "Number ending in 0 (Failed)"
test_payment "237670000001@cameroon" "REJECTED" "Number ending in 1 (Rejected)"
test_payment "237670000002@cameroon" "TIMEOUT" "Number ending in 2 (Timeout)"
test_payment "237670000004@cameroon" "PENDING" "Number ending in 4 (Pending)"

echo "==================================="
echo "Test completed!"
echo "==================================="