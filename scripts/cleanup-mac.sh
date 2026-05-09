#!/bin/bash

echo "=== Clash Lite Cleanup Tool ==="
echo "This script will remove all Clash Lite related files and services."
read -p "Are you sure you want to continue? (y/N) " -n 1 -r
echo
if [[ ! $REPLY =~ ^[Yy]$ ]]; then
    echo "Aborted."
    exit 1
fi

# Remove files
echo "Removing files..."
sudo rm -rf "/Applications/Clash Lite.app"
sudo rm -rf "/Applications/Clash\\ Lite.app"
sudo rm -rf ~/Library/Application\ Support/Clash\ Lite
sudo rm -rf ~/Library/Caches/Clash\ Lite
sudo rm -f ~/Library/Preferences/lite.clash.app.plist

echo "Cleanup complete. Please restart your computer to complete the process."
