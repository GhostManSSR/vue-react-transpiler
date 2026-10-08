import React from "react";

export interface ComponentProps {
  userId: number;
  onLoaded?: (user: User) => void;
}
export const Component: React.FC<ComponentProps> = (props: ComponentProps) => {
  const {
    userId,
    onLoaded
  } = props;
  interface User {
    id: number;
    name: string;
  }
  interface UserProfileProps {
    userId: number;
    onLoaded?: (user: User) => void;
  }
  const [user, setUser] = React.useState(() => null);
  const [loading, setLoading] = React.useState(() => false);
  const [error, setError] = React.useState(() => null);
  const __runEffect0 = () => {
    const controller = new AbortController();
    const loadUser = async () => {
      setLoading(true);
      setError(null);
      try {
        const response = await fetch(`/api/users/${userId}`, {
          signal: controller.signal
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
  };
  let __cleanupEffect0: (() => void) | undefined;
  React.useEffect(() => {
    (() => {
      __cleanupEffect0 = __runEffect0();
    })();
  }, []);
  const __watchReady0 = React.useRef(false);
  React.useEffect(() => {
    if (!__watchReady0.current) {
      __watchReady0.current = true;
      return;
    }
    __cleanupEffect0?.();
    __cleanupEffect0 = __runEffect0();
  }, [userId, onLoaded]);
  React.useEffect(() => () => queueMicrotask(() => (() => {
    __cleanupEffect0?.();
  })()), []);
  return <section><p>{loading ? 'Loading...' : user?.name ?? 'User not found'}</p><p>{error}</p><button disabled={loading} onClick={() => setUser(null)}>Clear</button></section>;
};
