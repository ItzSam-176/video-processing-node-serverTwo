#!/bin/bash

# Install CMake and build tools
apt-get update
apt-get install -y cmake build-essential python3 git

# Install Node dependencies
npm install

echo "✅ Build complete with CMake"
