package com.rhythmarchitect.backend.controller;
import com.rhythmarchitect.backend.model.SongRequest;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RestController;

@RestController
public class SongController {

    @PostMapping("/api/chart")
        public String generateChart(@RequestBody SongRequest request) { //@RequestBody tells Spring to take JSON and use Jackson into a SongRequest Object

    return "Received song: " + request.getTitle()
            + " | BPM: " + request.getBpm();
    }
}