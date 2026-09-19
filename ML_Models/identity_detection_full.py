import os
import json
import torch
import numpy as np
import pandas as pd
import joblib
from torch import nn

# -----------------------------
# Autoencoder (same architecture)
# -----------------------------
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
        return self.decoder(self.encoder(x))


# -----------------------------
# Preprocessing (same as test pipeline)
# -----------------------------
def preprocess_user_data(df, feature_cols, scaler):
    df["record timestamp"] = pd.to_numeric(df["record timestamp"])
    df["time_delta"] = df["record timestamp"].diff().fillna(0)

    df_encoded = pd.get_dummies(df, columns=["button", "state"])

    for col in feature_cols:
        if col not in df_encoded.columns:
            df_encoded[col] = 0

    df_encoded = df_encoded[feature_cols]
    data = df_encoded.values.astype(np.float32)

    return scaler.transform(data)


# -----------------------------
# Compute reconstruction error
# -----------------------------
def compute_error(model_user_folder, data_user):
    model_path = f"./ML_Models/autoencoder_user_{model_user_folder}_test.pth"
    feature_path = f"./ML_Models/feature_cols_{model_user_folder}.json"
    scaler_path = f"./ML_Models/scaler_{model_user_folder}.pkl"

    with open(feature_path, "r") as f:
        feature_cols = json.load(f)

    scaler = joblib.load(scaler_path)

    processed = preprocess_user_data(data_user, feature_cols, scaler)

    model = InteractionAutoencoder(processed.shape[1])
    model.load_state_dict(torch.load(model_path))
    model.eval()

    x = torch.tensor(processed)

    with torch.no_grad():
        recon = model(x)
        mse = torch.mean((recon - x) ** 2, dim=1)

    return mse.mean().item()


# -----------------------------
# MAIN HOLISTIC TEST (DIRECT COMPARISON)
# -----------------------------
if __name__ == "__main__":

    TEST_DIR = r"C:\Users\deres\IBM_hackathon_2026\test_files"

    # Load all user test data
    user_data = {}
    for user_folder in os.listdir(TEST_DIR):
        user_path = os.path.join(TEST_DIR, user_folder)
        if os.path.isdir(user_path):

            dfs = []
            for f in os.listdir(user_path):
                fp = os.path.join(user_path, f)
                try:
                    dfs.append(pd.read_csv(fp))
                except:
                    continue

            if dfs:
                user_data[user_folder] = pd.concat(dfs, ignore_index=True)

    users = list(user_data.keys())

    # Store results
    genuine_errors = {}
    impostor_errors = {u: [] for u in users}
    detection_results = {}

    # -------------------------
    # Compute genuine errors
    # -------------------------
    for user in users:
        err = compute_error(user, user_data[user])
        genuine_errors[user] = err
        print(f"Genuine error for {user}: {err:.6f}")

    # -------------------------
    # Compute impostor errors
    # -------------------------
    for model_user in users:
        for data_user in users:
            if model_user != data_user:
                err = compute_error(model_user, user_data[data_user])
                impostor_errors[model_user].append(err)
                print(f"Impostor error: model={model_user}, data={data_user}, err={err:.6f}")

    # -------------------------
    # DIRECT COMPARISON DETECTION
    # -------------------------
    for user in users:
        g_err = genuine_errors[user]
        imp_errs = impostor_errors[user]

        # Count how many impostors have higher error than genuine
        TP = sum(1 for e in imp_errs if e > g_err)
        FN = sum(1 for e in imp_errs if e <= g_err)

        detection_rate = TP / (TP + FN)

        detection_results[user] = {
            "genuine_error": g_err,
            "impostor_errors": imp_errs,
            "TP": TP,
            "FN": FN,
            "detection_rate": detection_rate
        }

    # -------------------------
    # PRINT RESULTS
    # -------------------------
    print("\n=== DIRECT COMPARISON DETECTION RESULTS ===")
    for user, res in detection_results.items():
        print(f"\nUser: {user}")
        print(f"Genuine Error: {res['genuine_error']:.6f}")
        print(f"TP (impostors correctly detected): {res['TP']}")
        print(f"FN (impostors missed): {res['FN']}")
        print(f"Detection Rate: {res['detection_rate']:.4f}")
