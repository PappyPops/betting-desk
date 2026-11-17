#!/bin/sh
# Stamp every script/style link with a version so browsers pick up new code right after a push.
V=$(date +%Y%m%d%H%M)
sed -i -E "s#(from '\./[a-z]+\.js)(\?v=[0-9]+)?'#\1?v=$V'#g; s#(import\('\./[a-z]+\.js)(\?v=[0-9]+)?'#\1?v=$V'#g" js/*.js
sed -i -E "s#(js/app\.js|css/app\.css)(\?v=[0-9]+)?\"#\1?v=$V\"#g" index.html
echo "$V"
