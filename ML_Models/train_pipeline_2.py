import os
import json
import pandas as pd
import numpy as np
import torch
import torch.nn as nn
import torch.optim as optim
from torch.utils.data import DataLoader, TensorDataset
from sklearn.preprocessing import StandardScaler
import joblib

class InteractionAutoencoder(nn.Module):
    def __init__(self, input_dim):
        super().__init__()
        self.encoder = nn.Sequential(
            nn.Linear(input_dim, 32),
            nn.ReLU(),
            nn.Linear(32, 16),
            nn.ReLU(),
            nn.Linear(16, 8),
        )
        self.decoder = nn.Sequential(
            nn.Linear(8, 16),
            nn.ReLU(),
            nn.Linear(16, 32),
            nn.ReLU(),
            nn.Linear(32, input_dim)
        )

    def forward(self, x):
        encoded = self.encoder(x)
        decoded = self.decoder(encoded)
        return decoded


def preprocess_user_data(df: pd.DataFrame):
    expected_cols = ['record timestamp', 'client timestamp', 'button', 'state', 'x', 'y']
    for col in expected_cols:
        if col not in df.columns:
            raise ValueError(f"Missing expected column: {col}")

    # Convert timestamps
    df['record timestamp'] = pd.to_numeric(df['record timestamp'])

    # Basic time delta
    df['time_delta'] = df['record timestamp'].diff().fillna(0)

    # Movement deltas
    df['dx'] = df['x'].diff().fillna(0)
    df['dy'] = df['y'].diff().fillna(0)

    # Distance
    df['distance'] = np.sqrt(df['dx']**2 + df['dy']**2)

    # Velocity
    df['velocity'] = df['distance'] / df['time_delta'].replace(0, np.nan)
    df['velocity'] = df['velocity'].fillna(0)

    # Acceleration
    df['acceleration'] = df['velocity'].diff().fillna(0)

    # Jerk (derivative of acceleration)
    df['jerk'] = df['acceleration'].diff().fillna(0)

    # Angle of movement
    df['angle'] = np.arctan2(df['dy'], df['dx']).fillna(0)

    # Angular velocity
    df['angular_velocity'] = df['angle'].diff().fillna(0)

    # Encode button + state
    df_encoded = pd.get_dummies(df, columns=['button', 'state'])

    # Select features
    feature_cols = [
        'time_delta',
        'dx', 'dy',
        'distance',
        'velocity',
        'acceleration',
        'jerk',
        'angle',
        'angular_velocity'
    ] + [c for c in df_encoded.columns if c.startswith('button_') or c.startswith('state_')]

    data = df_encoded[feature_cols].values.astype(np.float32)

    # Scale
    scaler = StandardScaler()
    scaled_data = scaler.fit_transform(data)

    return scaled_data, feature_cols, scaler



def train_autoencoder(user_id, data_matrix, feature_cols, scaler, epochs=50, batch_size=32):
    print(f"--- Training Autoencoder for User: {user_id} ---")

    tensor_data = torch.tensor(data_matrix)
    dataloader = DataLoader(TensorDataset(tensor_data), batch_size=batch_size, shuffle=True)

    input_dim = data_matrix.shape[1]
    model = InteractionAutoencoder(input_dim)
    criterion = nn.MSELoss()
    optimizer = optim.Adam(model.parameters(), lr=0.001)

    model.train()
    for epoch in range(epochs):
        total_loss = 0
        for batch in dataloader:
            inputs = batch[0]
            outputs = model(inputs)
            loss = criterion(outputs, inputs)

            optimizer.zero_grad()
            loss.backward()
            optimizer.step()
            total_loss += loss.item()

        if (epoch + 1) % 10 == 0:
            print(f"Epoch [{epoch+1}/{epochs}], Loss: {total_loss / len(dataloader):.4f}")

    os.makedirs("./ML_Models", exist_ok=True)

    torch.save(model.state_dict(), f"./ML_Models/autoencoder_user_{user_id}_test_curser.pth")

    with open(f"./ML_Models/feature_cols_{user_id}_curser.json", "w") as f:
        json.dump(feature_cols, f)

    joblib.dump(scaler, f"./ML_Models/scaler_{user_id}_curser.pkl")

    print(f"Saved model, feature columns, and scaler for user {user_id}\n")


if __name__ == "__main__":
    TRAINING_DIR = r"C:\Users\deres\IBM_hackathon_2026\training_files"

    if os.path.exists(TRAINING_DIR):
        for user_folder in os.listdir(TRAINING_DIR):
            user_path = os.path.join(TRAINING_DIR, user_folder)

            if os.path.isdir(user_path):
                user_id = user_folder
                user_dfs = []

                for file_name in os.listdir(user_path):
                    file_path = os.path.join(user_path, file_name)
                    if os.path.isdir(file_path):
                        continue
                    try:
                        df = pd.read_csv(file_path)
                        user_dfs.append(df)
                    except Exception as e:
                        print(f"Skipping {file_name}: {e}")

                if user_dfs:
                    combined_df = pd.concat(user_dfs, ignore_index=True)
                    processed_data, feature_cols, scaler = preprocess_user_data(combined_df)
                    train_autoencoder(user_id, processed_data, feature_cols, scaler)
                else:
                    print(f"No CSV files found for {user_id}.")

        print("Training complete.")
    else:
        print(f"Directory '{TRAINING_DIR}' does not exist.")
