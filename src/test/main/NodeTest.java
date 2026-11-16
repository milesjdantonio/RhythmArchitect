package main;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertNull;
import static org.junit.jupiter.api.Assertions.assertSame;

import org.junit.jupiter.api.Test;

/**
 * Node: the spec's test plan (getNext, setNext, getData, setData; good and bad cases).
 */
class NodeTest
{
    @Test
    void getNextReturnsTheNextNode()
    {
        Node<String> last = new Node<>("b");
        Node<String> first = new Node<>("a", last);
        assertSame(last, first.getNext());
    }

    @Test
    void getNextIsNullAtTheEndOfTheChain()
    {
        assertNull(new Node<>("a").getNext());
    }

    @Test
    void setNextLinksAndNullEndsTheChain()
    {
        Node<String> a = new Node<>("a");
        Node<String> b = new Node<>("b");
        a.setNext(b);
        assertSame(b, a.getNext());
        a.setNext(null);
        assertNull(a.getNext());
    }

    @Test
    void getDataReturnsWhatItHolds()
    {
        assertEquals("a", new Node<>("a").getData());
    }

    @Test
    void setDataReplacesItAndMayBeNull()
    {
        Node<String> n = new Node<>("a");
        n.setData("b");
        assertEquals("b", n.getData());
        n.setData(null);
        assertNull(n.getData());
    }
}
