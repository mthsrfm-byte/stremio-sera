#!/usr/bin/env bash
# Monta o APK do Fire TV sem Gradle: aapt2 (recursos), javac + d8 (código), zipalign e apksigner.
# Precisa do Android SDK (build-tools 35.0.0 e platforms;android-34) em ANDROID_HOME e do
# dist-firetv/ já gerado (npm run build:firetv), que vai dentro do APK como versão inicial.
# Saída: android/build/Seraflix-FireTV.apk
set -euo pipefail
cd "$(dirname "$0")"

SDK="${ANDROID_HOME:-${ANDROID_SDK_ROOT:-}}"
[ -n "$SDK" ] || { echo "Defina ANDROID_HOME (Android SDK)"; exit 1; }
BT="$SDK/build-tools/35.0.0"
JAR="$SDK/platforms/android-34/android.jar"
[ -f ../dist-firetv/files.json ] || { echo "Falta o dist-firetv/: rode npm run build:firetv"; exit 1; }

# Versão do APK: número de commits (sempre sobe) e a versão do app.
CODE="${APK_VERSION_CODE:-$(git rev-list --count HEAD 2>/dev/null || echo 1)}"
NAME="$(node -p "require('../appinfo.json').version")-firetv.$CODE"

rm -rf build
mkdir -p build/gen build/classes build/dex build/assets/web
cp -r ../dist-firetv/. build/assets/web/

"$BT/aapt2" compile --dir res -o build/res.zip
"$BT/aapt2" link -I "$JAR" --manifest AndroidManifest.xml -A build/assets -o build/base.apk \
  --java build/gen --min-sdk-version 22 --target-sdk-version 30 \
  --version-code "$CODE" --version-name "$NAME" build/res.zip

javac -nowarn -Xlint:-options -source 8 -target 8 -encoding UTF-8 -bootclasspath "$JAR:$BT/core-lambda-stubs.jar" \
  -d build/classes $(find src build/gen -name '*.java')
"$BT/d8" --release --min-api 22 --lib "$JAR" --output build/dex $(find build/classes -name '*.class')

cp build/base.apk build/unsigned.apk
(cd build/dex && zip -q ../unsigned.apk classes.dex)
"$BT/zipalign" -f -p 4 build/unsigned.apk build/aligned.apk

# Assinatura. Todo APK novo só instala por cima do anterior se a chave for a mesma, então ela
# fica fora do repositório (que é público): no GitHub vem do segredo FIRETV_KEYSTORE_B64 (+
# FIRETV_KEYSTORE_PASSWORD); localmente, de FIRETV_KEYSTORE ou android/seraflix.jks.
# Sem chave nenhuma, gera uma temporária: o APK instala, mas o próximo pede desinstalar antes.
KS="${FIRETV_KEYSTORE:-seraflix.jks}"
PASS="${FIRETV_KEYSTORE_PASSWORD:-seraflix}"
if [ ! -f "$KS" ]; then
  echo "AVISO: sem chave de assinatura ($KS); usando uma temporária." >&2
  KS=build/temp.jks
  keytool -genkeypair -keystore "$KS" -storepass "$PASS" -keypass "$PASS" -alias seraflix \
    -keyalg RSA -keysize 2048 -validity 36500 -dname "CN=Seraflix, O=Seraflix" > /dev/null 2>&1
fi
"$BT/apksigner" sign --ks "$KS" --ks-pass "pass:$PASS" --key-pass "pass:$PASS" \
  --out build/Seraflix-FireTV.apk build/aligned.apk
echo "APK: android/build/Seraflix-FireTV.apk ($NAME)"
