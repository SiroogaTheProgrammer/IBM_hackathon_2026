import os
import json
import pandas as pd
import numpy as np
import torch
import torch.nn as nn
from sklearn.preprocessing import StandardScaler
import joblib

class InteractionAutoencoder(nn.Module):
    def __init__(self, input_dim):
        super().__init__()
        self.encoder = nn.Sequential(
            nn.Linear(input_dim, 32),
            nn.ReLU(),
            nn.Linear(32, 16),
            nn.ReLU()
        )
        self.decoder = nn.Sequential(
            nn.Linear(16, 32),
            nn.ReLU(),
            nn.Linear(32, input_dim)
        )

    def forward(self, x):
        encoded = self.encoder(x)
        decoded = self.decoder(encoded)
        return decoded


def preprocess_user_data(df, feature_cols, scaler):
    df['record timestamp'] = pd.to_numeric(df['record timestamp'])
    df['time_delta'] = df['record timestamp'].diff().fillna(0)

    df_encoded = pd.get_dummies(df, columns=['button', 'state'])

    for col in feature_cols:
        if col not in df_encoded.columns:
            df_encoded[col] = 0

    df_encoded = df_encoded[feature_cols]

    data = df_encoded.values.astype(np.float32)
    scaled_data = scaler.transform(data)

    return scaled_data


def test_autoencoder(user_id, test_dir):
    print(f"\n--- Testing Autoencoder for User: {user_id} ---")

    model_path = f"./ML_Models/autoencoder_user_{user_id}_test.pth"
    feature_path = f"./ML_Models/feature_cols_{user_id}.json"
    scaler_path = f"./ML_Models/scaler_{user_id}.pkl"

    if not os.path.exists(model_path):
        print("Model not found.")
        return
    if not os.path.exists(feature_path):
        print("Feature columns not found.")
        return
    if not os.path.exists(scaler_path):
        print("Scaler not found.")
        return

    with open(feature_path, "r") as f:
        feature_cols = json.load(f)

    scaler = joblib.load(scaler_path)

    user_dfs = []
    for file_name in os.listdir(test_dir):
        file_path = os.path.join(test_dir, file_name)
        if os.path.isdir(file_path):
            continue
        try:
            df = pd.read_csv(file_path)
            user_dfs.append(df)
        except:
            continue

    if not user_dfs:
        print("No readable test files.")
        return

    combined_df = pd.concat(user_dfs, ignore_index=True)
    test_data = preprocess_user_data(combined_df, feature_cols, scaler)

    input_dim = test_data.shape[1]
    model = InteractionAutoencoder(input_dim)
    model.load_state_dict(torch.load(model_path))
    model.eval()

    test_tensor = torch.tensor(test_data)

    with torch.no_grad():
        reconstructed = model(test_tensor)
        mse = torch.mean((reconstructed - test_tensor) ** 2, dim=1)

    avg_error = mse.mean().item()
    print(f"Average Reconstruction Error: {avg_error:.6f}")

    # Save results
    results_path = "./ML_Models/test_results.txt"
    with open(results_path, "a") as f:
        f.write(f"User {user_id}: {avg_error:.6f}\n")

    print(f"Saved result for {user_id} to {results_path}")


if __name__ == "__main__":
    TEST_DIR_BASE = r"C:\Users\deres\IBM_hackathon_2026\test_files"

    if os.path.exists(TEST_DIR_BASE):
        for user_folder in os.listdir(TEST_DIR_BASE):
            user_path = os.path.join(TEST_DIR_BASE, user_folder)
            if os.path.isdir(user_path):
                test_autoencoder(user_folder, user_path)
    else:
        print(f"Directory '{TEST_DIR_BASE}' does not exist.")
