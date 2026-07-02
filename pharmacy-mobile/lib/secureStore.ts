import * as ExpoSecureStore from 'expo-secure-store';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { Platform } from 'react-native';

export async function getItemAsync(key: string, options?: any): Promise<string | null> {
  if (Platform.OS === 'web') {
    return AsyncStorage.getItem(key);
  }
  try {
    return await ExpoSecureStore.getItemAsync(key, options);
  } catch (e) {
    console.warn('SecureStore.getItemAsync failed, falling back to AsyncStorage:', e);
    return AsyncStorage.getItem(key);
  }
}

export async function setItemAsync(key: string, value: string, options?: any): Promise<void> {
  if (Platform.OS === 'web') {
    return AsyncStorage.setItem(key, value);
  }
  try {
    await ExpoSecureStore.setItemAsync(key, value, options);
  } catch (e) {
    console.warn('SecureStore.setItemAsync failed, falling back to AsyncStorage:', e);
    await AsyncStorage.setItem(key, value);
  }
}

export async function deleteItemAsync(key: string, options?: any): Promise<void> {
  if (Platform.OS === 'web') {
    return AsyncStorage.removeItem(key);
  }
  try {
    await ExpoSecureStore.deleteItemAsync(key, options);
  } catch (e) {
    console.warn('SecureStore.deleteItemAsync failed, falling back to AsyncStorage:', e);
    await AsyncStorage.removeItem(key);
  }
}

export async function isAvailableAsync(): Promise<boolean> {
  if (Platform.OS === 'web') {
    return false;
  }
  try {
    return await ExpoSecureStore.isAvailableAsync();
  } catch {
    return false;
  }
}
