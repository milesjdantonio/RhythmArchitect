package com.rhythmarchitect.backend.chart;

import org.springframework.beans.factory.annotation.Value;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;

import main.SongMapper;

/** The AI charter: SongMapper (src/java/main/SongMapper.java), set up from application.properties. */
@Configuration
public class CharterConfig {

    @Bean(destroyMethod = "close")
    public SongMapper songMapper(
        @Value("${rythm.anthropic.api-key:}") String apiKey,
        @Value("${rythm.charter.model}") String model,
        @Value("${rythm.charter.effort}") String effort,
        @Value("${rythm.charter.max-tokens}") long maxTokens,
        @Value("${rythm.charter.timeout-seconds}") long timeoutSeconds) {
        return new SongMapper(apiKey, model, effort, maxTokens, timeoutSeconds);
    }
}
