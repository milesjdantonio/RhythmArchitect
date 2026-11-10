package main;

import java.util.Objects;

public class Note
{
    private NoteType noteType;
    private MusicNoteType musicNoteType;
    private double noteLength;
    private double timeStamp;
    private int lane;

    public Note(NoteType nT, MusicNoteType mNT, double nL, double tS, int lane)
    {
        noteType = nT;
        musicNoteType = mNT;
        noteLength = nL;
        timeStamp = tS;
        this.lane = lane;
    }

    public NoteType getNoteType()
    {
        return noteType;
    }

    public void setNoteType(NoteType nT)
    {
        noteType = nT;
    }

    public MusicNoteType getMusicNoteType()
    {
        return musicNoteType;
    }

    public void setMusicNoteType(MusicNoteType mNT)
    {
        musicNoteType = mNT;
    }

    public double getNoteLength()
    {
        return noteLength;
    }

    public void setNoteLength(double nL)
    {
        noteLength = nL;
    }

    public double getTimeStamp()
    {
        return timeStamp;
    }

    public void setTimeStamp(double tS)
    {
        timeStamp = tS;
    }

    public int getLane()
    {
        return lane;
    }

    public void setLane(int lane)
    {
        this.lane = lane;
    }

    @Override
    public boolean equals(Object obj)
    {
        if(!(obj instanceof Note other))
        {
            return false;
        }
        boolean noteTypes = Objects.equals(noteType, other.noteType);
        boolean musicNoteTypes = Objects.equals(musicNoteType, other.musicNoteType);
        boolean noteLengths = noteLength == other.noteLength;
        return noteTypes && musicNoteTypes && noteLengths;
    }

    @Override
    public int hashCode()
    {
        return Objects.hash(noteType, musicNoteType, noteLength);
    }

    @Override
    public String toString()
    {
        return noteType + ", " + musicNoteType + ", " + noteLength;
    }
}
