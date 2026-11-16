package main;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertNotEquals;
import static org.junit.jupiter.api.Assertions.assertTrue;

import org.junit.jupiter.api.Test;

/**
 * Note: the spec's test plan (getNoteType, getNoteLength, toString; good and bad cases) and the
 * defaults for bad input.
 */
class NoteTest
{
    @Test
    void keepsWhatItIsGiven()
    {
        Note n = new Note(NoteType.C, MusicNoteType.ACCENT, 0.5, 12.25, 3);
        assertEquals(NoteType.C, n.getNoteType());
        assertEquals(MusicNoteType.ACCENT, n.getMusicNoteType());
        assertEquals(0.5, n.getNoteLength());
        assertEquals(12.25, n.getTimeStamp());
        assertEquals(3, n.getLane());
    }

    @Test
    void aNoteIsTappedUnlessItIsAHold()
    {
        assertFalse(new Note(NoteType.C, null, 0.5, 0, 0).isHold());
        Note held = new Note(NoteType.C, null, 2, 0, 0, true);
        assertTrue(held.isHold());
        assertEquals(2, held.getNoteLength());
        held.setHold(false);
        assertFalse(held.isHold());
    }

    @Test
    void noNoteTypeIsA()
    {
        assertEquals(NoteType.A, new Note(null, MusicNoteType.NORMAL, 1, 0, 0).getNoteType());
        Note n = new Note(NoteType.G, MusicNoteType.NORMAL, 1, 0, 0);
        n.setNoteType(null);
        assertEquals(NoteType.A, n.getNoteType());
    }

    @Test
    void noMusicNoteTypeIsNormal()
    {
        assertEquals(MusicNoteType.NORMAL, new Note(NoteType.C, null, 1, 0, 0).getMusicNoteType());
    }

    @Test
    void aLengthOfZeroOrLessIsOne()
    {
        assertEquals(1, new Note(NoteType.C, null, 0, 0, 0).getNoteLength());
        assertEquals(1, new Note(NoteType.C, null, -2, 0, 0).getNoteLength());
        assertEquals(1, new Note(NoteType.C, null, Double.NaN, 0, 0).getNoteLength());
        Note n = new Note(NoteType.C, null, 0.5, 0, 0);
        n.setNoteLength(-1);
        assertEquals(1, n.getNoteLength());
    }

    @Test
    void settersChangeTimeAndLane()
    {
        Note n = new Note(NoteType.C, null, 1, 0, 0);
        n.setTimeStamp(3.5);
        n.setLane(2);
        n.setMusicNoteType(MusicNoteType.END);
        assertEquals(3.5, n.getTimeStamp());
        assertEquals(2, n.getLane());
        assertEquals(MusicNoteType.END, n.getMusicNoteType());
    }

    @Test
    void toStringIsNoteTypeAndLength()
    {
        assertEquals("C, 0.5", new Note(NoteType.C, MusicNoteType.NORMAL, 0.5, 0, 0).toString());
        assertEquals("A, 1.0", new Note(null, null, 0, 0, 0).toString());
        assertEquals("E, 0.144", new Note(NoteType.E, null, 0.144200265, 0, 0).toString());
    }

    @Test
    void equalNotesHaveTheSameTypesAndLength()
    {
        Note a = new Note(NoteType.C, MusicNoteType.NORMAL, 0.5, 1, 0);
        Note b = new Note(NoteType.C, MusicNoteType.NORMAL, 0.5, 9, 3);
        assertEquals(a, b);
        assertEquals(a.hashCode(), b.hashCode());
        assertNotEquals(a, new Note(NoteType.D, MusicNoteType.NORMAL, 0.5, 1, 0));
        assertNotEquals(a, null);
    }
}
