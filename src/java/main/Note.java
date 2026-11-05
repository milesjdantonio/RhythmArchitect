public class Note
{
    private NoteType noteType;
    private MusicNoteType musicNoteType;
    private double noteLength;
    private double timeStamp;
    private int lane;

    public void Note(NoteType nT, MusicNoteType mNT, double nL, double tS, int lane)
    {
        noteType = nT;
        musicNoteType = mNT;
        noteLength = nL;
        timeStamp tS;
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

    public void setMusicNoteType(NoteType mNT)
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
    public boolean equals(Note other)
    {
        if(other == null)
        {
            return false;
        }
        boolean noteTypes = noteType.equals(other.noteType);
        boolean musicNoteTypes = musicNoteType.equals(other.musicNoteType);
        boolean noteLengths = noteLength == other.noteLength;
        return noteTypes && musicNoteTypes && noteLengths;
    }

    @Override
    public String toString()
    {
        return noteType + ", " + musicNoteType + ", " + noteLength;
    }
}