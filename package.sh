#!/bin/bash
set -e

cd "$(dirname "$0")"

if ! command -v vsce &> /dev/null; then
  echo "vsce가 설치되어 있지 않습니다. 설치합니다..."
  npm install -g @vscode/vsce
fi

vsce package

echo "패키징 완료: $(ls -t *.vsix | head -1)"
