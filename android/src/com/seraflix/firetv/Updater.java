package com.seraflix.firetv;

import android.content.Context;
import android.content.SharedPreferences;
import android.content.res.AssetManager;

import org.json.JSONArray;
import org.json.JSONObject;

import java.io.ByteArrayOutputStream;
import java.io.File;
import java.io.FileInputStream;
import java.io.FileOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.security.MessageDigest;
import java.util.HashMap;
import java.util.Map;

// Atualização do app web pelo GitHub, como o TizenBrew faz na TV Samsung: a cada abertura pergunta
// qual foi o último commit da main que mexeu em dist-firetv/, baixa só os arquivos que mudaram
// (files.json traz o sha256 de cada um), confere tudo e troca de versão. Sem rede ou com erro,
// segue com a versão que já tem (a que veio dentro do APK, na primeira vez).
final class Updater {
    static final String REPO = "mthsrfm-byte/stremio-sera";
    static final String BRANCH = "main";
    static final String DIR = "dist-firetv";

    private static final String PREFS = "web";
    private static final String KEY_SHA = "sha";

    private final Context ctx;
    private final File root;

    Updater(Context ctx) {
        this.ctx = ctx.getApplicationContext();
        this.root = new File(this.ctx.getFilesDir(), "web");
    }

    // Pasta da versão baixada em uso, ou null para usar a que veio no APK (assets/web).
    File current() {
        String sha = prefs().getString(KEY_SHA, null);
        if (sha == null) return null;
        File dir = new File(root, sha);
        return new File(dir, "files.json").isFile() ? dir : null;
    }

    // Último commit que mudou o build do Fire TV, ou null sem rede / sem build na main ainda.
    String latestSha(int timeoutMs) {
        try {
            String url = "https://api.github.com/repos/" + REPO + "/commits?sha=" + BRANCH + "&path=" + DIR + "/files.json&per_page=1";
            JSONArray list = new JSONArray(new String(get(url, timeoutMs), "UTF-8"));
            return list.length() > 0 ? list.getJSONObject(0).getString("sha") : null;
        } catch (Exception e) {
            return null;
        }
    }

    boolean isCurrent(String sha) {
        return sha != null && sha.equals(prefs().getString(KEY_SHA, null)) && current() != null;
    }

    // Baixa a versão do commit sha. Devolve true se ela passou a ser a atual.
    boolean install(String sha) {
        File tmp = new File(root, sha + ".tmp");
        try {
            deleteTree(tmp);
            String base = "https://raw.githubusercontent.com/" + REPO + "/" + sha + "/" + DIR + "/";
            byte[] manifestBytes = get(base + "files.json", 20000);
            JSONArray files = new JSONObject(new String(manifestBytes, "UTF-8")).getJSONArray("files");
            Map<String, String> have = currentHashes();
            File cur = current();
            for (int i = 0; i < files.length(); i++) {
                JSONObject f = files.getJSONObject(i);
                String path = f.getString("path");
                String hash = f.getString("sha256");
                if (path.contains("..")) throw new IOException("caminho inválido: " + path);
                File out = new File(tmp, path);
                out.getParentFile().mkdirs();
                byte[] data = null;
                // Arquivo igual ao que já está aqui: copia em vez de baixar (fontes, ícones...).
                if (hash.equals(have.get(path))) data = readLocal(cur, path);
                if (data == null || !hash.equals(sha256(data))) data = get(base + path, 60000);
                if (!hash.equals(sha256(data))) throw new IOException("arquivo corrompido: " + path);
                write(out, data);
            }
            write(new File(tmp, "files.json"), manifestBytes);
            File dest = new File(root, sha);
            deleteTree(dest);
            if (!tmp.renameTo(dest)) throw new IOException("não deu para trocar de versão");
            prefs().edit().putString(KEY_SHA, sha).commit();
            return true;
        } catch (Exception e) {
            deleteTree(tmp);
            return false;
        }
    }

    // Lê um arquivo de uma versão: a pasta baixada, ou o APK quando dir é null. A tela aberta
    // fica presa à versão com que abriu: uma atualização no meio não mistura arquivos.
    InputStream open(File dir, String path) throws IOException {
        if (dir != null) return new FileInputStream(new File(dir, path));
        return ctx.getAssets().open("web/" + path, AssetManager.ACCESS_STREAMING);
    }

    private Map<String, String> currentHashes() {
        Map<String, String> out = new HashMap<>();
        try {
            InputStream in = open(current(), "files.json");
            JSONArray files = new JSONObject(new String(readAll(in), "UTF-8")).getJSONArray("files");
            for (int i = 0; i < files.length(); i++) {
                JSONObject f = files.getJSONObject(i);
                out.put(f.getString("path"), f.getString("sha256"));
            }
        } catch (Exception e) {
            // sem lista: baixa tudo
        }
        return out;
    }

    private byte[] readLocal(File cur, String path) {
        try {
            InputStream in = cur != null ? new FileInputStream(new File(cur, path)) : ctx.getAssets().open("web/" + path);
            return readAll(in);
        } catch (IOException e) {
            return null;
        }
    }

    // Apaga as versões velhas. Só na abertura, antes de a tela carregar (nenhuma está em uso).
    void prune() {
        File keep = current();
        File[] dirs = root.listFiles();
        if (dirs == null) return;
        for (File d : dirs) if (keep == null || !d.getName().equals(keep.getName())) deleteTree(d);
    }

    private SharedPreferences prefs() {
        return ctx.getSharedPreferences(PREFS, Context.MODE_PRIVATE);
    }

    static byte[] get(String url, int timeoutMs) throws IOException {
        HttpURLConnection c = (HttpURLConnection) new URL(url).openConnection();
        c.setConnectTimeout(Math.min(timeoutMs, 10000));
        c.setReadTimeout(timeoutMs);
        c.setRequestProperty("User-Agent", "Seraflix-FireTV");
        try {
            int code = c.getResponseCode();
            if (code != 200) throw new IOException("HTTP " + code + " em " + url);
            return readAll(c.getInputStream());
        } finally {
            c.disconnect();
        }
    }

    static byte[] readAll(InputStream in) throws IOException {
        try {
            ByteArrayOutputStream out = new ByteArrayOutputStream();
            byte[] buf = new byte[16384];
            int n;
            while ((n = in.read(buf)) > 0) out.write(buf, 0, n);
            return out.toByteArray();
        } finally {
            in.close();
        }
    }

    private static void write(File f, byte[] data) throws IOException {
        FileOutputStream out = new FileOutputStream(f);
        try {
            out.write(data);
        } finally {
            out.close();
        }
    }

    static String sha256(byte[] data) {
        try {
            byte[] d = MessageDigest.getInstance("SHA-256").digest(data);
            StringBuilder sb = new StringBuilder();
            for (byte b : d) sb.append(String.format("%02x", b));
            return sb.toString();
        } catch (Exception e) {
            return "";
        }
    }

    static void deleteTree(File f) {
        if (f == null || !f.exists()) return;
        File[] kids = f.listFiles();
        if (kids != null) for (File k : kids) deleteTree(k);
        f.delete();
    }
}
