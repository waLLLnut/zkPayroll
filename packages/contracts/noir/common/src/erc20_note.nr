// fails to compile if this file is moved to erc20 crate

use super::note::Note;
use protocol_types::traits::Serialize;

pub struct Erc20Note {
    pub owner: crate::WaAddress,
    pub amount: crate::TokenAmount,
    pub randomness: Field,
}

impl crate::Note for Erc20Note {}

impl Erc20Note {
    pub fn sub_and_emit_change<let N: u32>(
        context: &mut crate::Context,
        notes: [Erc20NoteConsumptionInputs; N],
        amount: crate::TokenAmount,
        change_randomness: Field,
        secret_key: Field,
    ) {
        let mut subtracted = crate::TokenAmount::zero(amount.token);
        for note in notes {
            note.consume(context, secret_key);
            subtracted += note.note.amount;
        }
        Self {
            owner: crate::WaAddress::from_secret_key(secret_key),
            amount: subtracted - amount,
            randomness: change_randomness,
        }
            .emit(context);
    }
}

// Serialize: [owner.x, owner.y, token, amount, randomness] = 5 fields
// Changed from 4 to 5 because WaAddress is now 2 fields (x, y) instead of 1
impl crate::Serialize<5> for Erc20Note {
    fn serialize(self) -> [Field; 5] {
        self
            .owner
            .serialize()  // 2 fields: [x, y]
            .concat(self.amount.token.serialize())  // 1 field
            .concat([self.amount.amount.to_integer()])  // 1 field
            .concat([self.randomness])  // 1 field
    }
}

impl crate::OwnedNote for Erc20Note {
    fn owner(self) -> crate::WaAddress {
        self.owner
    }
}

pub type Erc20NoteConsumptionInputs = crate::NoteConsumptionInputs<Erc20Note>;
