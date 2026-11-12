package main;

import java.util.Objects;

/**
 * One note of a chart: which letter it is (NoteType), what it does in the music (MusicNoteType),
 * how long it lasts (noteLength, seconds), when it reaches the hit line (timeStamp, seconds
 * from beat 0), its lane (0-3: keys D F J K) and whether it is held (a hold: the key stays down
 * for its length) or tapped.
 *
 * Bad input gets the spec's defaults: no note type is A, no music note type is NORMAL, and a
 * length of zero or less is 1.
 */
public class Note
{
    /** The note type used when none is given. */
    public static final NoteType DEFAULT_NOTE_TYPE = NoteType.A;
    /** The length used when the one given is zero or less. */
    public static final double DEFAULT_LENGTH = 1;

    private NoteType noteType;
    private MusicNoteType musicNoteType;
    private double noteLength;
    private double timeStamp;
    private int lane;
    private boolean hold;

    /**
     * Makes a tapped note.
     *
     * @param nT    its letter (null: A)
     * @param mNT   what it does in the music (null: NORMAL)
     * @param nL    how long it is held, in seconds (zero or less: 1)
     * @param tS    when it reaches the hit line, in seconds from beat 0
     * @param lane  its lane, 0-3
     */
    public Note(NoteType nT, MusicNoteType mNT, double nL, double tS, int lane)
    {
        this(nT, mNT, nL, tS, lane, false);
    }

    /**
     * Makes a note, tapped or held.
     *
     * @param nT    its letter (null: A)
     * @param mNT   what it does in the music (null: NORMAL)
     * @param nL    how long it lasts, in seconds (zero or less: 1); a hold is held this long
     * @param tS    when it reaches the hit line, in seconds from beat 0
     * @param lane  its lane, 0-3
     * @param hold  true for a hold, false for a tap
     */
    public Note(NoteType nT, MusicNoteType mNT, double nL, double tS, int lane, boolean hold)
    {
        setNoteType(nT);
        setMusicNoteType(mNT);
        setNoteLength(nL);
        timeStamp = tS;
        this.lane = lane;
        this.hold = hold;
    }

    /**
     * @return its letter
     */
    public NoteType getNoteType()
    {
        return noteType;
    }

    /**
     * @param nT its letter (null: A)
     */
    public void setNoteType(NoteType nT)
    {
        noteType = nT == null ? DEFAULT_NOTE_TYPE : nT;
    }

    /**
     * @return what it does in the music
     */
    public MusicNoteType getMusicNoteType()
    {
        return musicNoteType;
    }

    /**
     * @param mNT what it does in the music (null: NORMAL)
     */
    public void setMusicNoteType(MusicNoteType mNT)
    {
        musicNoteType = mNT == null ? MusicNoteType.NORMAL : mNT;
    }

    /**
     * @return how long it is held, in seconds
     */
    public double getNoteLength()
    {
        return noteLength;
    }

    /**
     * @param nL how long it is held, in seconds (zero or less, or not a number: 1)
     */
    public void setNoteLength(double nL)
    {
        noteLength = nL > 0 ? nL : DEFAULT_LENGTH;
    }

    /**
     * @return when it reaches the hit line, in seconds from beat 0
     */
    public double getTimeStamp()
    {
        return timeStamp;
    }

    /**
     * @param tS when it reaches the hit line, in seconds from beat 0
     */
    public void setTimeStamp(double tS)
    {
        timeStamp = tS;
    }

    /**
     * @return its lane, 0-3 (keys D F J K)
     */
    public int getLane()
    {
        return lane;
    }

    /**
     * @param lane its lane, 0-3
     */
    public void setLane(int lane)
    {
        this.lane = lane;
    }

    /**
     * @return true for a hold (the key stays down for its length), false for a tap
     */
    public boolean isHold()
    {
        return hold;
    }

    /**
     * @param hold true for a hold, false for a tap
     */
    public void setHold(boolean hold)
    {
        this.hold = hold;
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

    /**
     * @return the note as "NoteType, noteLength" (seconds, to the millisecond), e.g. "C, 0.5"
     */
    @Override
    public String toString()
    {
        return noteType + ", " + Math.round(noteLength * 1000) / 1000.0;
    }
}
