let locked = false;

export const isAppLockActive = () => locked;

export const setAppLockActive = (value: boolean) => {
  locked = value;
};
