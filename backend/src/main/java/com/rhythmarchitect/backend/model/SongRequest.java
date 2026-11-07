package com.rhythmarchitect.backend.model;

public class SongRequest {

    private String title;
    private double bpm;

    public String getTitle() {
        return title;
    }

    public void setTitle(String title) {
        this.title = title;
    }

    public double getBpm() {
        return bpm;
    }

    public void setBpm(double bpm) {
        this.bpm = bpm;
    }
}