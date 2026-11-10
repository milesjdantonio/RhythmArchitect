package com.rhythmarchitect.backend.sources;

import java.io.IOException;
import java.net.URI;
import java.net.URLEncoder;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.nio.charset.StandardCharsets;
import java.time.Duration;
import java.util.Map;
import java.util.stream.Collectors;

import org.springframework.stereotype.Component;

import tools.jackson.databind.JsonNode;
import tools.jackson.databind.ObjectMapper;

/**
 * Fetches metadata and chart text (never audio): YouTube's API or oEmbed, an osu! mirror's
 * search, osu!'s .osu files.
 */
@Component
public class Http {

    /** Mirrors ask apps to name themselves (some refuse anything that looks like a bot or server). */
    static final String UA = "RythmArchitect/0.1 (private project)";

    /** A source answered with something other than 2xx. */
    public static class StatusException extends IOException {
        final int status;

        StatusException(String host, int status) {
            super(host + " answered " + status);
            this.status = status;
        }
    }

    private final HttpClient client = HttpClient.newBuilder()
        .connectTimeout(Duration.ofSeconds(8))
        .followRedirects(HttpClient.Redirect.NORMAL)
        .build();
    private final ObjectMapper json;

    public Http(ObjectMapper json) {
        this.json = json;
    }

    public JsonNode getJson(String url) throws IOException {
        return json.readTree(get(url, "application/json"));
    }

    public String getText(String url) throws IOException {
        return get(url, "*/*");
    }

    private String get(String url, String accept) throws IOException {
        URI uri = URI.create(url);
        HttpRequest req = HttpRequest.newBuilder(uri)
            .timeout(Duration.ofSeconds(12))
            .header("User-Agent", UA)
            .header("Accept", accept)
            .GET()
            .build();
        try {
            HttpResponse<String> res = client.send(req, HttpResponse.BodyHandlers.ofString(StandardCharsets.UTF_8));
            if (res.statusCode() / 100 != 2) throw new StatusException(uri.getHost(), res.statusCode());
            return res.body();
        } catch (InterruptedException e) {
            Thread.currentThread().interrupt();
            throw new IOException("Interrupted", e);
        }
    }

    public static String query(Map<String, String> params) {
        return params.entrySet().stream()
            .map(e -> enc(e.getKey()) + "=" + enc(e.getValue()))
            .collect(Collectors.joining("&"));
    }

    public static String enc(String s) {
        return URLEncoder.encode(s, StandardCharsets.UTF_8);
    }
}
