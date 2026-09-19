import os
import json
import torch
from torch import nn

# Autoencoder architecture
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


def count_parameters(model):
    return sum(p.numel() for p in model.parameters())


def get_model_input_dim(feature_json_path):
    with open(feature_json_path, "r") as f:
        feature_cols = json.load(f)
    return len(feature_cols)


if __name__ == "__main__":
    BASE_DIR = os.path.abspath("./ML_Models")
    RESULTS_PATH = os.path.join(BASE_DIR, "model_stats.txt")

    print("Model directory:", BASE_DIR)
    print("Results will be saved to:", RESULTS_PATH)
    print()

    found_models = []

    # Find all model files
    for filename in os.listdir(BASE_DIR):
        if filename.startswith("autoencoder_user_") and filename.endswith("_test.pth"):
            found_models.append(filename)

    if not found_models:
        print("❌ No model files found matching pattern: autoencoder_user_*_test.pth")
        exit()

    print("Found model files:")
    for f in found_models:
        print(" •", f)
    print("\nComputing stats...\n")

    # Clear previous results
    with open(RESULTS_PATH, "w") as f:
        f.write("=== Autoencoder Model Statistics ===\n\n")

    # Process each model
    for filename in found_models:
        user_id = filename.replace("autoencoder_user_", "").replace("_test.pth", "")
        model_path = os.path.join(BASE_DIR, filename)

        # Feature file
        feature_file = os.path.join(BASE_DIR, f"feature_cols_{user_id}.json")
        if not os.path.exists(feature_file):
            print(f"⚠ Missing feature file for {user_id}, skipping.")
            continue

        # Determine input dimension
        input_dim = get_model_input_dim(feature_file)

        # Load model
        model = InteractionAutoencoder(input_dim)
        model.load_state_dict(torch.load(model_path))

        # Compute stats
        param_count = count_parameters(model)
        file_size_bytes = os.path.getsize(model_path)
        file_size_kb = file_size_bytes / 1024
        file_size_mb = file_size_bytes / (1024 * 1024)

        # Print results
        print(f"User: {user_id}")
        print(f"  Parameters: {param_count}")
        print(f"  File Size: {file_size_kb:.2f} KB ({file_size_mb:.4f} MB)")
        print()

        # Save results (append)
        with open(RESULTS_PATH, "a") as f:
            f.write(
                f"User: {user_id}\n"
                f"  Parameters: {param_count}\n"
                f"  File Size: {file_size_kb:.2f} KB ({file_size_mb:.4f} MB)\n\n"
            )

    print(f"Saved all results to:\n{RESULTS_PATH}")
