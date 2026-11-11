package main;

/**
 * One link of a Queue: the data it holds and the next node (null at the end of the chain).
 *
 * @param <T> what the node holds
 */
public class Node<T>
{
    Node<T> next;
    T data;

    /**
     * Makes a node with no next node.
     *
     * @param data the data it holds (may be null)
     */
    public Node(T data)
    {
        this(data, null);
    }

    /**
     * Makes a node linked to another.
     *
     * @param data the data it holds (may be null)
     * @param next the next node (null at the end of the chain)
     */
    public Node(T data, Node<T> next)
    {
        this.data = data;
        this.next = next;
    }

    /**
     * @return the next node, or null at the end of the chain
     */
    public Node<T> getNext()
    {
        return next;
    }

    /**
     * @param next the next node (null ends the chain here)
     */
    public void setNext(Node<T> next)
    {
        this.next = next;
    }

    /**
     * @return the data this node holds
     */
    public T getData()
    {
        return data;
    }

    /**
     * @param data the data this node holds (may be null)
     */
    public void setData(T data)
    {
        this.data = data;
    }
}
