package com.rhythmarchitect.backend.web;

/**
 * An error the player sees. The handler answers {@code { "error": message }} with this status,
 * and the app shows the message as written (docs/api.md).
 */
public class ApiException extends RuntimeException {

    private final int status;

    public ApiException(int status, String message) {
        super(message);
        this.status = status;
    }

    public int status() {
        return status;
    }

    public static ApiException badRequest(String message) {
        return new ApiException(400, message);
    }

    public static ApiException notFound(String message) {
        return new ApiException(404, message);
    }
}
