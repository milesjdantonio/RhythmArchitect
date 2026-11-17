package com.rhythmarchitect.backend.web;

import java.util.Map;

import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

/**
 * Whether the server is up: the app asks this when it opens, and shows its "waking the server"
 * screen while there's no answer (a sleeping free server takes a while to start). Touches nothing
 * else, so it answers at once.
 */
@RestController
@RequestMapping("/api")
public class HealthController {

    @GetMapping("/health")
    public Map<String, Object> health() {
        return Map.of("ok", true);
    }
}
