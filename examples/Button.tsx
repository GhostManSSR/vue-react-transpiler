import React from "react";
export interface ComponentProps {
  msg: string;
  disabled: boolean;
  type: 'button' | 'submit' | 'reset' | undefined;
  onClick?: () => void;
}
export const Component: React.FC<ComponentProps> = (props: ComponentProps) => {
  const {
    msg,
    disabled,
    type,
    onClick
  } = props;

  return <button type={type} disabled={disabled} onClick={() => onClick?.()}>{msg}</button>;
};
