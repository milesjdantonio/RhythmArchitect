package main;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertNull;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.junit.jupiter.api.Assertions.assertTrue;

import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;

/**
 * Queue: the spec's test plan for the core methods (enqueue, dequeue, peek, isEmpty, getSize,
 * clear), good and bad cases, plus first-in-first-out order over many items.
 */
class QueueTest
{
    private Queue<String> queue;

    @BeforeEach
    void setUp()
    {
        queue = new Queue<>();
    }

    @Test
    void aNewQueueIsEmpty()
    {
        assertTrue(queue.isEmpty());
        assertEquals(0, queue.getSize());
    }

    @Test
    void enqueueAddsToTheBack()
    {
        queue.enqueue("a");
        queue.enqueue("b");
        assertEquals(2, queue.getSize());
        assertFalse(queue.isEmpty());
        assertEquals("a", queue.peek());
    }

    @Test
    void enqueueTakesANodeAndCutsItLooseFromWhatFollowedIt()
    {
        Node<String> tail = new Node<>("left behind");
        queue.enqueue(new Node<>("a", tail));
        assertEquals(1, queue.getSize());
        assertEquals("a", queue.dequeue());
        assertTrue(queue.isEmpty());
    }

    @Test
    void enqueueOfANullNodeAddsNothing()
    {
        queue.enqueue((Node<String>) null);
        assertTrue(queue.isEmpty());
        queue.enqueue("a");
        queue.enqueue((Node<String>) null);
        assertEquals(1, queue.getSize());
    }

    @Test
    void nullDataIsStillAnItem()
    {
        queue.enqueue((String) null);
        assertEquals(1, queue.getSize());
        assertNull(queue.dequeue());
    }

    @Test
    void dequeueRemovesFromTheFrontInOrder()
    {
        queue.enqueue("a");
        queue.enqueue("b");
        queue.enqueue("c");
        assertEquals("a", queue.dequeue());
        assertEquals("b", queue.dequeue());
        assertEquals(1, queue.getSize());
        assertEquals("c", queue.dequeue());
        assertTrue(queue.isEmpty());
    }

    @Test
    void dequeueOfAnEmptyQueueThrows()
    {
        assertThrows(EmptyQueueException.class, queue::dequeue);
        queue.enqueue("a");
        queue.dequeue();
        assertThrows(EmptyQueueException.class, queue::dequeue);
    }

    @Test
    void peekShowsTheFrontWithoutRemovingIt()
    {
        queue.enqueue("a");
        queue.enqueue("b");
        assertEquals("a", queue.peek());
        assertEquals("a", queue.peek());
        assertEquals(2, queue.getSize());
    }

    @Test
    void peekOfAnEmptyQueueThrows()
    {
        assertThrows(EmptyQueueException.class, queue::peek);
    }

    @Test
    void clearEmptiesTheQueueAndItWorksAfter()
    {
        queue.enqueue("a");
        queue.enqueue("b");
        queue.clear();
        assertTrue(queue.isEmpty());
        assertEquals(0, queue.getSize());
        assertThrows(EmptyQueueException.class, queue::peek);
        queue.enqueue("c");
        assertEquals("c", queue.peek());
    }

    @Test
    void clearOfAnEmptyQueueChangesNothing()
    {
        queue.clear();
        assertTrue(queue.isEmpty());
    }

    @Test
    void emptiedThenRefilledKeepsItsOrder()
    {
        queue.enqueue("a");
        queue.dequeue();
        queue.enqueue("b");
        queue.enqueue("c");
        assertEquals("b", queue.dequeue());
        assertEquals("c", queue.dequeue());
    }

    @Test
    void manyItemsComeOutInTheOrderTheyWentIn()
    {
        Queue<Integer> numbers = new Queue<>();
        for(int i = 0; i < 1000; i++)
        {
            numbers.enqueue(i);
        }
        assertEquals(1000, numbers.getSize());
        for(int i = 0; i < 1000; i++)
        {
            assertEquals(i, numbers.dequeue());
        }
        assertTrue(numbers.isEmpty());
    }
}
