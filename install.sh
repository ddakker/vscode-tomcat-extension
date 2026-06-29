#!/bin/bash

./package.sh

latest=$(ls -t *.vsix 2>/dev/null | head -1)
if [ -z "$latest" ]; then
  echo "vsix 파일이 없습니다."
  exit 1
fi
echo "설치: $latest"
code --install-extension "$latest"
echo "설치완료: $latest"
