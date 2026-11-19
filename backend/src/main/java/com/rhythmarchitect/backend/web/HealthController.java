package com.rhythmarchitect.backend.web;

import java.util.LinkedHashMap;
import java.util.Map;

import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

import com.rhythmarchitect.backend.songs.SongStore;

/**
 * Whether the server is up (the app asks while it wakes), and where the song bank is: in Supabase,
 * in the file, or still starting, and, if Supabase isn't working, why. Waits for nothing (the
 * bank's state as it stands), so it answers at once. Open it in a browser to check the database.
 */
@RestController
@RequestMapping("/api")
public class HealthController {

    private final SongStore store;

    public HealthController(SongStore store) {
        this.store = store;
    }

    @GetMapping("/health")
    public Map<String, Object> health() {
        Map<String, Object> out = new LinkedHashMap<>();
        out.put("ok", true);
        out.putAll(store.status());
        return out;
    }
}
