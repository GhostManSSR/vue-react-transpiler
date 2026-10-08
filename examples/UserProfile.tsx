import { useEffect, useState } from 'react';

interface User {
    id: number;
    name: string;
}

interface UserProfileProps {
    userId: number;
    onLoaded?: (user: User) => void;
}

export function UserProfile({ userId, onLoaded }: UserProfileProps) {
    const [user, setUser] = useState<User | null>(null);
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState<string | null>(null);

    useEffect(() => {
        const controller = new AbortController();

        const loadUser = async () => {
            setLoading(true);
            setError(null);

            try {
                const response = await fetch(`/api/users/${userId}`, {
                    signal: controller.signal,
                });

                if (!response.ok) {
                    throw new Error('Unable to load user');
                }

                const nextUser: User = await response.json();

                setUser(nextUser);
                onLoaded?.(nextUser);
            } catch (cause) {
                if (!controller.signal.aborted) {
                    setError(cause instanceof Error ? cause.message : String(cause));
                }
            } finally {
                if (!controller.signal.aborted) {
                    setLoading(false);
                }
            }
        };

        void loadUser();

        return () => {
            controller.abort();
        };
    }, [userId, onLoaded]);

    return (
        <section>
            <p>{loading ? 'Loading...' : user?.name ?? 'User not found'}</p>

            <p>{error}</p>

            <button disabled={loading} onClick={() => setUser(null)}>
                Clear
            </button>
        </section>
    );
}
