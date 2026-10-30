package com.seraflix.firetv;

import android.annotation.SuppressLint;
import android.app.Activity;
import android.graphics.Bitmap;
import android.graphics.Color;
import android.net.wifi.WifiManager;
import android.os.Build;
import android.os.Bundle;
import android.os.Handler;
import android.os.Looper;
import android.util.Log;
import android.view.Gravity;
import android.view.KeyEvent;
import android.view.View;
import android.view.WindowManager;
import android.webkit.ConsoleMessage;
import android.webkit.JavascriptInterface;
import android.webkit.ValueCallback;
import android.webkit.WebChromeClient;
import android.webkit.WebResourceRequest;
import android.webkit.WebResourceResponse;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.widget.FrameLayout;
import android.widget.TextView;

import java.io.ByteArrayInputStream;
import java.io.File;
import java.io.InputStream;
import java.net.URLDecoder;
import java.util.HashMap;
import java.util.Locale;
import java.util.Map;
import java.util.regex.Pattern;

// Seraflix no Fire TV Stick: o app web (dist-firetv/) servido de dentro do APK ou da última versão
// baixada do GitHub, num WebView em tela cheia. As teclas que o WebView não entrega à página
// (Voltar, mídia, Menu) vão para window.__seraKey com os códigos da Samsung que o app já entende.
public class MainActivity extends Activity {
    private static final String TAG = "Seraflix";
    // Domínio reservado do Android para conteúdo local: nunca vai para a rede.
    private static final String HOST = "appassets.androidplatform.net";
    private static final String HOME = "https://" + HOST + "/index.html";
    // A agenda (iCal) que o serviço da TV Samsung buscava: aqui o próprio app atende.
    private static final String CAL_PREFIX = "http://127.0.0.1:8092/api/cal?u=";
    private static final Pattern CAL_HOSTS = Pattern.compile("^https://([a-z0-9-]+\\.)*(google\\.com|googleusercontent\\.com|outlook\\.com|office365\\.com|live\\.com|icloud\\.com|apple\\.com)/.*", Pattern.CASE_INSENSITIVE);
    // Quanto esperar o GitHub na abertura antes de abrir a versão que já tem.
    private static final int CHECK_TIMEOUT_MS = 4000;

    private static final Map<Integer, Integer> KEYS = new HashMap<>();
    static {
        KEYS.put(KeyEvent.KEYCODE_BACK, 10009);
        KEYS.put(KeyEvent.KEYCODE_MEDIA_PLAY_PAUSE, 179);
        KEYS.put(KeyEvent.KEYCODE_MEDIA_PLAY, 415);
        KEYS.put(KeyEvent.KEYCODE_MEDIA_PAUSE, 19);
        KEYS.put(KeyEvent.KEYCODE_MEDIA_STOP, 413);
        KEYS.put(KeyEvent.KEYCODE_MEDIA_FAST_FORWARD, 417);
        KEYS.put(KeyEvent.KEYCODE_MEDIA_REWIND, 412);
        KEYS.put(KeyEvent.KEYCODE_MEDIA_NEXT, 417);
        KEYS.put(KeyEvent.KEYCODE_MEDIA_PREVIOUS, 412);
        // Botão ☰ do controle: favoritar (a tecla amarela da Samsung).
        KEYS.put(KeyEvent.KEYCODE_MENU, 405);
        KEYS.put(KeyEvent.KEYCODE_PROG_RED, 403);
        KEYS.put(KeyEvent.KEYCODE_PROG_GREEN, 404);
        KEYS.put(KeyEvent.KEYCODE_PROG_YELLOW, 405);
        KEYS.put(KeyEvent.KEYCODE_PROG_BLUE, 406);
        KEYS.put(KeyEvent.KEYCODE_CHANNEL_UP, 33);
        KEYS.put(KeyEvent.KEYCODE_CHANNEL_DOWN, 34);
    }

    private final Handler ui = new Handler(Looper.getMainLooper());
    private Updater updater;
    private WebView web;
    private TextView status;
    // Versão que a tela aberta está usando (null: a do APK).
    private volatile File serving;
    private boolean loaded;
    private boolean checking;

    @Override
    protected void onCreate(Bundle saved) {
        super.onCreate(saved);
        getWindow().setFlags(WindowManager.LayoutParams.FLAG_FULLSCREEN, WindowManager.LayoutParams.FLAG_FULLSCREEN);
        updater = new Updater(this);
        updater.prune();

        FrameLayout box = new FrameLayout(this);
        box.setBackgroundColor(Color.parseColor("#0d0b14"));
        web = new WebView(this);
        web.setBackgroundColor(Color.parseColor("#0d0b14"));
        box.addView(web, new FrameLayout.LayoutParams(-1, -1));
        status = new TextView(this);
        status.setTextColor(Color.parseColor("#b9b4c7"));
        status.setTextSize(20);
        status.setGravity(Gravity.CENTER);
        box.addView(status, new FrameLayout.LayoutParams(-1, -1));
        setContentView(box);
        setup(web);

        // Procura versão nova antes de abrir; se o GitHub demorar, abre a que já tem.
        status.setText("Seraflix");
        new Thread(() -> {
            final String[] sha = { null };
            Thread probe = new Thread(() -> sha[0] = updater.latestSha(CHECK_TIMEOUT_MS));
            probe.start();
            try {
                probe.join(CHECK_TIMEOUT_MS + 500);
            } catch (InterruptedException ignored) {
            }
            if (sha[0] != null && !updater.isCurrent(sha[0])) {
                ui.post(() -> status.setText("Atualizando o Seraflix…"));
                boolean ok = updater.install(sha[0]);
                Log.i(TAG, "Atualização " + sha[0] + ": " + (ok ? "ok" : "falhou"));
            }
            ui.post(this::load);
        }).start();
    }

    private void load() {
        serving = updater.current();
        status.setVisibility(View.GONE);
        loaded = true;
        web.loadUrl(HOME);
        web.requestFocus();
    }

    @SuppressLint({ "SetJavaScriptEnabled", "AddJavascriptInterface" })
    private void setup(WebView w) {
        WebSettings s = w.getSettings();
        s.setJavaScriptEnabled(true);
        s.setDomStorageEnabled(true);
        s.setDatabaseEnabled(true);
        s.setMediaPlaybackRequiresUserGesture(false); // trailers e vídeo começam sozinhos
        s.setMixedContentMode(WebSettings.MIXED_CONTENT_ALWAYS_ALLOW); // stremio-service no PC é http
        s.setUseWideViewPort(true); // o app é desenhado em 1920×1080 (meta viewport)
        s.setLoadWithOverviewMode(true);
        s.setTextZoom(100);
        s.setSupportZoom(false);
        s.setBuiltInZoomControls(false);
        s.setDisplayZoomControls(false);
        s.setAllowFileAccess(false);
        s.setUserAgentString(s.getUserAgentString() + " Seraflix-FireTV/" + versionName());
        w.setFocusable(true);
        w.setFocusableInTouchMode(true);
        w.setVerticalScrollBarEnabled(false);
        w.setHorizontalScrollBarEnabled(false);
        w.addJavascriptInterface(new Bridge(), "SeraflixAndroid");

        w.setWebViewClient(new WebViewClient() {
            @Override
            public WebResourceResponse shouldInterceptRequest(WebView view, WebResourceRequest req) {
                return intercept(req.getUrl().toString());
            }

            @SuppressWarnings("deprecation")
            @Override
            public WebResourceResponse shouldInterceptRequest(WebView view, String url) {
                return intercept(url);
            }

            @Override
            public boolean shouldOverrideUrlLoading(WebView view, WebResourceRequest req) {
                // Só a página do app abre na tela inteira; links para fora não tiram o app do ar.
                return !HOST.equals(req.getUrl().getHost());
            }
        });

        w.setWebChromeClient(new WebChromeClient() {
            // Sem isto o WebView desenha um "play" cinza no vídeo antes de ele começar.
            @Override
            public Bitmap getDefaultVideoPoster() {
                Bitmap b = Bitmap.createBitmap(1, 1, Bitmap.Config.ARGB_8888);
                b.eraseColor(Color.TRANSPARENT);
                return b;
            }

            @Override
            public boolean onConsoleMessage(ConsoleMessage m) {
                Log.d(TAG, m.message() + " (" + m.sourceId() + ":" + m.lineNumber() + ")");
                return true;
            }
        });
    }

    private WebResourceResponse intercept(String url) {
        if (url.startsWith(CAL_PREFIX)) return calendar(url);
        if (!url.startsWith("https://" + HOST + "/")) return null;
        String path = url.substring(("https://" + HOST + "/").length());
        int q = path.indexOf('?');
        if (q >= 0) path = path.substring(0, q);
        q = path.indexOf('#');
        if (q >= 0) path = path.substring(0, q);
        if (path.isEmpty()) path = "index.html";
        if (path.contains("..")) return notFound();
        try {
            InputStream in = updater.open(serving, path);
            WebResourceResponse r = new WebResourceResponse(mime(path), mime(path).startsWith("text/") || path.endsWith(".js") || path.endsWith(".json") ? "utf-8" : null, in);
            Map<String, String> h = new HashMap<>();
            h.put("Access-Control-Allow-Origin", "*");
            h.put("Cache-Control", "no-cache");
            r.setResponseHeaders(h);
            return r;
        } catch (Exception e) {
            return notFound();
        }
    }

    // GET da agenda iCal sem esbarrar no CORS do Google (como fazia o serviço da TV).
    private WebResourceResponse calendar(String url) {
        Map<String, String> h = new HashMap<>();
        h.put("Access-Control-Allow-Origin", "*");
        h.put("Cache-Control", "no-store");
        try {
            String target = URLDecoder.decode(url.substring(CAL_PREFIX.length()), "UTF-8");
            if (!CAL_HOSTS.matcher(target).matches()) {
                return response(400, "text/plain", "endereço de agenda não permitido", h);
            }
            byte[] data = Updater.get(target, 30000);
            return response(200, "text/calendar", new String(data, "UTF-8"), h);
        } catch (Exception e) {
            return response(502, "text/plain", String.valueOf(e.getMessage()), h);
        }
    }

    private static WebResourceResponse response(int code, String mime, String body, Map<String, String> headers) {
        try {
            return new WebResourceResponse(mime, "utf-8", code, code == 200 ? "OK" : "Error", headers, new ByteArrayInputStream(body.getBytes("UTF-8")));
        } catch (Exception e) {
            return null;
        }
    }

    private static WebResourceResponse notFound() {
        return response(404, "text/plain", "404", new HashMap<>());
    }

    private static String mime(String path) {
        String p = path.toLowerCase(Locale.ROOT);
        if (p.endsWith(".html")) return "text/html";
        if (p.endsWith(".js")) return "application/javascript";
        if (p.endsWith(".css")) return "text/css";
        if (p.endsWith(".json")) return "application/json";
        if (p.endsWith(".png")) return "image/png";
        if (p.endsWith(".svg")) return "image/svg+xml";
        if (p.endsWith(".woff2")) return "font/woff2";
        if (p.endsWith(".woff")) return "font/woff";
        return "application/octet-stream";
    }

    @Override
    public boolean dispatchKeyEvent(KeyEvent e) {
        Integer code = KEYS.get(e.getKeyCode());
        if (code == null) return super.dispatchKeyEvent(e);
        if (!loaded) {
            if (e.getKeyCode() == KeyEvent.KEYCODE_BACK && e.getAction() == KeyEvent.ACTION_UP) finish();
            return true;
        }
        if (e.getAction() == KeyEvent.ACTION_DOWN) {
            final boolean back = e.getKeyCode() == KeyEvent.KEYCODE_BACK;
            web.evaluateJavascript("window.__seraKey ? (__seraKey(" + code + "), true) : false", new ValueCallback<String>() {
                @Override
                public void onReceiveValue(String r) {
                    // A página não carregou (erro, sem rede na primeira vez): Voltar fecha o app.
                    if (back && !"true".equals(r)) finish();
                }
            });
        }
        return true;
    }

    @Override
    protected void onPause() {
        super.onPause();
        // Saiu do app (botão Home): pausa o vídeo, que salva onde parou.
        web.evaluateJavascript("Array.prototype.forEach.call(document.querySelectorAll('video'),function(v){v.pause()})", null);
        web.onPause();
    }

    @Override
    protected void onResume() {
        super.onResume();
        web.onResume();
    }

    @Override
    protected void onDestroy() {
        web.destroy();
        super.onDestroy();
    }

    private void updateDone(String result) {
        checking = false;
        web.evaluateJavascript("window.__seraUpdate && __seraUpdate('" + result + "')", null);
        if ("updated".equals(result)) {
            ui.postDelayed(new Runnable() {
                @Override
                public void run() {
                    load();
                }
            }, 1500);
        }
    }

    private String versionName() {
        try {
            return getPackageManager().getPackageInfo(getPackageName(), 0).versionName;
        } catch (Exception e) {
            return "";
        }
    }

    // window.SeraflixAndroid na página.
    private final class Bridge {
        @JavascriptInterface
        public void exit() {
            ui.post(new Runnable() {
                @Override
                public void run() {
                    finish();
                }
            });
        }

        @JavascriptInterface
        public String getIp() {
            try {
                WifiManager wm = (WifiManager) getApplicationContext().getSystemService(WIFI_SERVICE);
                int ip = wm.getConnectionInfo().getIpAddress();
                if (ip != 0) return (ip & 0xff) + "." + (ip >> 8 & 0xff) + "." + (ip >> 16 & 0xff) + "." + (ip >> 24 & 0xff);
                // Cabo de rede (adaptador Ethernet): pega o IPv4 da interface ativa.
                for (java.net.NetworkInterface ni : java.util.Collections.list(java.net.NetworkInterface.getNetworkInterfaces())) {
                    if (!ni.isUp() || ni.isLoopback()) continue;
                    for (java.net.InetAddress a : java.util.Collections.list(ni.getInetAddresses())) {
                        if (a instanceof java.net.Inet4Address && !a.isLoopbackAddress()) return a.getHostAddress();
                    }
                }
            } catch (Exception ignored) {
            }
            return "";
        }

        @JavascriptInterface
        public String getModel() {
            return Build.MANUFACTURER + " " + Build.MODEL + " · Fire OS (Android " + Build.VERSION.RELEASE + ") · app " + versionName();
        }

        @JavascriptInterface
        public void keepScreenOn(final boolean on) {
            ui.post(new Runnable() {
                @Override
                public void run() {
                    if (on) getWindow().addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON);
                    else getWindow().clearFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON);
                }
            });
        }

        // "Procurar atualização" em Ajustes: baixa a versão nova e recarrega a tela nela.
        @JavascriptInterface
        public void checkUpdate() {
            if (checking) return;
            checking = true;
            new Thread(new Runnable() {
                @Override
                public void run() {
                    String sha = updater.latestSha(15000);
                    final String result;
                    if (sha == null) result = "error";
                    else if (updater.isCurrent(sha)) result = "none";
                    else result = updater.install(sha) ? "updated" : "error";
                    ui.post(new Runnable() {
                        @Override
                        public void run() {
                            updateDone(result);
                        }
                    });
                }
            }).start();
        }
    }
}
